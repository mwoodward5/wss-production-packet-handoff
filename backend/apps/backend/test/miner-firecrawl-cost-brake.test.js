"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  directoryCrawlEnabled,
  directoryCrawlLimit,
  operatorLineFirecrawlFallbackLimit,
  firecrawlEmergencyStop,
  firecrawlSearch,
  firecrawlScrapeHtml,
  firecrawlBranding,
  firecrawlCrawl,
  firecrawlRenderedJsonLd,
  mineBuildReady,
} = require("../lib/lead-miner");

// The #491 emergency cost law was removed (owner directive 2026-08-31): spend
// caps must never refuse discovery or compile work. The cost ledger still
// meters every call, and ONE emergency kill-switch (default OFF) can halt all
// Firecrawl if a runaway ever happens.

const SEARCH = "https://api.firecrawl.dev/v1/search";
const SCRAPE = "https://api.firecrawl.dev/v2/scrape";

test("directory crawl is back to default-on; explicit 0 opts out", () => {
  assert.equal(directoryCrawlEnabled({}), true);
  assert.equal(directoryCrawlEnabled({ GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "0" }), false);
  assert.equal(directoryCrawlEnabled({ GHOST_AGENCY_MINER_DIRECTORY_CRAWL: "1" }), true);
});

test("directory crawl allowance is generous (default 10, ceiling 25)", () => {
  assert.equal(directoryCrawlLimit({}), 10);
  assert.equal(directoryCrawlLimit({ GHOST_AGENCY_MINER_DIRECTORY_CRAWL_LIMIT: "3" }), 3);
  assert.equal(directoryCrawlLimit({ GHOST_AGENCY_MINER_DIRECTORY_CRAWL_LIMIT: "999" }), 25);
});

test("Operator Line paid Firecrawl fallbacks default to 25 and clamp at 25", () => {
  assert.equal(operatorLineFirecrawlFallbackLimit({ trigger: "operator_line" }, {}), 25);
  assert.equal(operatorLineFirecrawlFallbackLimit({ trigger: "operator_line" }, { GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "0" }), 0);
  assert.equal(operatorLineFirecrawlFallbackLimit({ trigger: "operator_line" }, { GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "2" }), 2);
  assert.equal(operatorLineFirecrawlFallbackLimit({ trigger: "operator_line" }, { GHOST_AGENCY_OPERATOR_LINE_FIRECRAWL_FALLBACK_LIMIT: "99" }), 25);
  assert.equal(operatorLineFirecrawlFallbackLimit({ trigger: "scheduled" }, {}), null);
});

test("the same Operator Line allowance still gates all three paid scrape fallback paths", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "lead-miner.js"), "utf8");
  assert.equal((source.match(/operatorLineFallbackAvailable\(\)/g) || []).length, 3);
  assert.equal((source.match(/consumeOperatorLineFallback\(\);/g) || []).length, 3);
});

// ------------------------------------------------------------------------- //
// EMERGENCY KILL-SWITCH — default OFF; when set it halts every Firecrawl lane //
// ------------------------------------------------------------------------- //

test("the emergency stop defaults OFF and only a literal 1 arms it", () => {
  assert.equal(firecrawlEmergencyStop({}), false);
  assert.equal(firecrawlEmergencyStop({ GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP: "0" }), false);
  assert.equal(firecrawlEmergencyStop({ GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP: "" }), false);
  assert.equal(firecrawlEmergencyStop({ GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP: "1" }), true);
});

test("every Firecrawl helper refuses with zero outbound calls under the emergency stop", async () => {
  const env = { GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP: "1" };
  const never = async () => { throw new Error("emergency stop must prevent any Firecrawl fetch"); };
  const search = await firecrawlSearch({ query: "plumbing in Spokane WA", apiKey: "k", endpoint: SEARCH, fetchImpl: never, env });
  assert.equal(search.ok, false);
  assert.equal(search.reason, "firecrawl_emergency_stop");
  const scraped = await firecrawlScrapeHtml({ url: "https://blocked.example/", apiKey: "k", endpoint: SCRAPE, fetchImpl: never, env });
  assert.equal(scraped.ok, false);
  assert.equal(scraped.reason, "firecrawl_emergency_stop");
  assert.equal(scraped.calls, 0);
  const branded = await firecrawlBranding({ url: "https://blocked.example/", apiKey: "k", endpoint: SCRAPE, fetchImpl: never, env });
  assert.equal(branded.ok, false);
  assert.equal(branded.reason, "firecrawl_emergency_stop");
  assert.equal(branded.calls, 0);
  const crawled = await firecrawlCrawl({ url: "https://www.bbb.org/us/tx/austin/category/plumber", apiKey: "k", endpoint: "https://api.firecrawl.dev/v2/crawl", fetchImpl: never, pollMs: 1, env });
  assert.equal(crawled.ok, false);
  assert.equal(crawled.reason, "firecrawl_emergency_stop");
  assert.equal(crawled.calls, 0);
  const rendered = await firecrawlRenderedJsonLd({ url: "https://blocked.example/", apiKey: "k", endpoint: SCRAPE, fetchImpl: never, env });
  assert.equal(rendered.ok, false);
  assert.equal(rendered.reason, "firecrawl_emergency_stop");
  assert.equal(rendered.calls, 0);
});

// ------------------------------------------------------------------------- //
// Integration: old thresholds no longer refuse work; the ledger still meters //
// ------------------------------------------------------------------------- //

function scrapeResponse(url) {
  return new Response(JSON.stringify({
    success: true,
    data: {
      url,
      html: `<!doctype html><html><head><title>Blocked Plumbing ${url}</title></head><body><h1>Blocked Plumbing</h1><p>Drain cleaning and water heaters.</p></body></html>`,
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
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

test("three bot-blocked sites under the Operator Line all recover — the old hard cap of two no longer refuses the third, and the ledger still meters every scrape", async () => {
  const SITES = [
    "https://blocked1.example/",
    "https://blocked2.example/",
    "https://blocked3.example/",
  ];
  const firecrawlPosts = { search: 0, scrape: 0 };
  const fetchImpl = async (url, options = {}) => {
    const target = typeof url === "string" ? url : String(url);
    const method = (options && options.method) || "GET";
    if (target === SEARCH && method === "POST") {
      firecrawlPosts.search++;
      return new Response(JSON.stringify({
        data: SITES.map((site, i) => ({ url: site, title: `Blocked Plumbing Co ${i + 1}` })),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (target === SCRAPE && method === "POST") {
      firecrawlPosts.scrape++;
      return scrapeResponse(target);
    }
    if (SITES.includes(target) && method === "GET") {
      return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  };

  const out = await mineBuildReady({
    trigger: "operator_line",
    lane: "sandbox",
    queries: [{ industry: "plumbing", location: "Spokane WA", textQuery: "plumbing in Spokane WA", queryGroup: 0 }],
    candidatesPerQuery: 3,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
      GHOST_AGENCY_PHOTO_BANK: "false",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
  });

  // The #491 law hard-capped the shared Operator Line fallback pool at two;
  // a third bot-blocked site in one invocation was refused recovery. The pool
  // is now 25, so all three sites get their paid scrape.
  assert.equal(firecrawlPosts.search, 1, "one discovery search for the whole run");
  assert.equal(firecrawlPosts.scrape, 3, "all three blocked sites are recovered — the old cap of two must not refuse the third");
  // The cost ledger still meters every paid call.
  assert.equal(out.cost.firecrawl_search_calls, 1, JSON.stringify(out.cost));
  assert.equal(out.cost.firecrawl_scrape_calls, 3, "every paid scrape lands on the ledger");
  assert.equal(out.cost.homepage_scrape_fallbacks, 3, "every homepage recovery is metered");
});

test("the emergency stop halts a mining run before any Firecrawl request leaves the process", async () => {
  const firecrawlAttempts = [];
  const fetchImpl = async (url, options = {}) => {
    const target = typeof url === "string" ? url : String(url);
    if (/api\.firecrawl\.dev/.test(target)) firecrawlAttempts.push(target);
    if (target === SEARCH) {
      return new Response(JSON.stringify({ data: [{ url: "https://www.acme-plumbing.example/", title: "Acme Plumbing" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("not found", { status: 404 });
  };

  const out = await mineBuildReady({
    queries: [{ industry: "plumbing", location: "Austin TX", textQuery: "plumbing in Austin TX", queryGroup: 0 }],
    candidatesPerQuery: 4,
    env: {
      FIRECRAWL_API_KEY: "firecrawl-test-key",
      GHOST_AGENCY_FIRECRAWL_EMERGENCY_STOP: "1",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
    },
    firecrawlEndpoint: SEARCH,
    firecrawlScrapeEndpoint: SCRAPE,
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.example", priority: 10 }],
    mirrorImpl: async () => mirrorPass(),
  });

  assert.deepEqual(firecrawlAttempts, [], "the armed kill-switch must prevent every outbound Firecrawl request");
  assert.equal(out.records.length, 0, "no discovery means no records");
  const stopNote = (out.rejects || []).find((r) => r.reason === "firecrawl_emergency_stop");
  assert.ok(stopNote, "the halt is recorded honestly on the funnel: " + JSON.stringify(out.rejects || []).slice(0, 400));
});
