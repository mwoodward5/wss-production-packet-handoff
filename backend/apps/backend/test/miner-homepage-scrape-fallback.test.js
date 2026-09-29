"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  mineBuildReady,
  firecrawlScrapeHtml,
  homepageScrapeFallbackEnabled,
  homepageScrapeFallbackLimit,
} = require("../lib/lead-miner");

const SEARCH = "https://api.firecrawl.dev/v1/search";
const SCRAPE = "https://api.firecrawl.dev/v2/scrape";
const HOMEPAGE = "https://blocked.example/";

function searchResponse() {
  return new Response(JSON.stringify({
    data: [{ url: HOMEPAGE, title: "Blocked Plumbing Co" }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function scrapeResponse(html = "<html><body>Blocked Plumbing Co — drain cleaning, water heaters</body></html>") {
  return new Response(JSON.stringify({
    success: true,
    data: { html, url: HOMEPAGE },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// Routes every fetch by URL: Firecrawl search, the prospect homepage, and the
// Firecrawl scrape endpoint. The homepage GET is the one that 403s in
// production; the scrape endpoint is the recovery path.
function router({ homepageStatus = 403, scrapeHtml } = {}) {
  return async (url, options = {}) => {
    const target = typeof url === "string" ? url : String(url);
    const method = (options && options.method) || "GET";
    if (target === SEARCH && method === "POST") return searchResponse();
    if (target === SCRAPE && method === "POST") {
      if (scrapeHtml === null) return new Response(JSON.stringify({ success: false }), { status: 200 });
      return scrapeResponse(scrapeHtml);
    }
    if (target === HOMEPAGE && method === "GET") {
      return new Response("forbidden", { status: homepageStatus, headers: { "content-type": "text/plain" } });
    }
    return new Response("not found", { status: 404 });
  };
}

function baseInput(fetchImpl, env = {}) {
  return {
    queries: [{ industry: "plumbing", location: "Austin TX", textQuery: "plumbing in Austin TX", rawQuery: false }],
    candidatesPerQuery: 4,
    env: { GOOGLE_PLACES_API_KEY: "places", FIRECRAWL_API_KEY: "firecrawl", ...env },
    firecrawlEndpoint: SEARCH,
    firecrawlScrapeEndpoint: SCRAPE,
    fetchImpl,
  };
}

// --------------------------------------------------------------------------- //
// firecrawlScrapeHtml unit contract
// --------------------------------------------------------------------------- //

test("firecrawlScrapeHtml returns no_firecrawl_key without a key", async () => {
  const out = await firecrawlScrapeHtml({ url: HOMEPAGE, apiKey: "", fetchImpl: async () => { throw new Error("never"); } });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_firecrawl_key");
  assert.equal(out.calls, 0);
});

test("firecrawlScrapeHtml parses a success payload into html + finalUrl", async () => {
  const out = await firecrawlScrapeHtml({
    url: HOMEPAGE,
    apiKey: "firecrawl",
    endpoint: SCRAPE,
    fetchImpl: async () => scrapeResponse("<html><body>hi</body></html>"),
  });
  assert.equal(out.ok, true);
  assert.equal(out.html, "<html><body>hi</body></html>");
  assert.equal(out.finalUrl, HOMEPAGE);
  assert.equal(out.calls, 1);
});

test("firecrawlScrapeHtml fails closed on non-ok http, invalid json, and empty html", async () => {
  const httpErr = await firecrawlScrapeHtml({
    url: HOMEPAGE, apiKey: "k", endpoint: SCRAPE,
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });
  assert.equal(httpErr.ok, false);
  assert.equal(httpErr.reason, "firecrawl_scrape_http_500");

  const badJson = await firecrawlScrapeHtml({
    url: HOMEPAGE, apiKey: "k", endpoint: SCRAPE,
    fetchImpl: async () => new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(badJson.ok, false);
  assert.equal(badJson.reason, "firecrawl_scrape_invalid_json");

  const empty = await firecrawlScrapeHtml({
    url: HOMEPAGE, apiKey: "k", endpoint: SCRAPE,
    fetchImpl: async () => new Response(JSON.stringify({ success: true, data: { html: "" } }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "firecrawl_scrape_empty_html");
});

test("firecrawlScrapeHtml reports unreachable when the fetch throws", async () => {
  const out = await firecrawlScrapeHtml({
    url: HOMEPAGE, apiKey: "k", endpoint: SCRAPE,
    fetchImpl: async () => { throw new Error("ETIMEDOUT"); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "firecrawl_scrape_unreachable");
  assert.match(out.detail, /ETIMEDOUT/);
});

// --------------------------------------------------------------------------- //
// Integration: the homepage GET 403 is recovered by the scrape fallback
// --------------------------------------------------------------------------- //

test("a 403-blocked homepage is recovered by the Firecrawl scrape and survives stage 2", async () => {
  const out = await mineBuildReady(baseInput(router({ homepageStatus: 403 })));
  assert.equal(out.ok, true, JSON.stringify(out));
  // Exactly one paid homepage scrape was spent to recover the blocked homepage.
  assert.equal(out.cost.homepage_scrape_fallbacks, 1, JSON.stringify(out.cost));
  // Stage 2 (homepage_fetch) survived at least one candidate — the scrape
  // recovery let it through instead of stopping at http_403.
  const s2 = out.funnel.find((stage) => stage.stage === "2_homepage_fetch");
  assert.ok(s2.survived >= 1, "the scrape fallback recovered HTML so stage 2 was survived");
  // No stage-2 http_403 rejection remains for the recovered candidate.
  const s2Rejections = (out.rejects || []).filter((r) => r.stage === "2_homepage_fetch" && /http_403/.test(r.reason || ""));
  assert.equal(s2Rejections.length, 0, "the 403 must not terminal-reject a candidate the scrape recovered");
});

test("without the scrape fallback, a 403 homepage stops at stage 2 with http_403", async () => {
  const out = await mineBuildReady(baseInput(router({ homepageStatus: 403 }), { GHOST_AGENCY_MINER_SCRAPE_FALLBACK: "0" }));
  assert.equal(out.cost.homepage_scrape_fallbacks, 0, "the kill switch forbids any paid homepage scrape");
  const s2 = out.funnel.find((stage) => stage.stage === "2_homepage_fetch");
  assert.equal(s2.survived, 0, "with no recovery path the blocked homepage cannot survive stage 2");
  assert.ok((s2.rejected.http_403 || 0) >= 1, "the 403 is recorded as the stage-2 rejection");
});

test("a scrape that also fails falls back through to a stage-2 rejection carrying the scrape reason", async () => {
  const out = await mineBuildReady(baseInput(router({ homepageStatus: 403, scrapeHtml: null })));
  // The scrape endpoint returned success:false, so recovery failed.
  assert.equal(out.cost.homepage_scrape_fallbacks, 1);
  const s2 = out.funnel.find((stage) => stage.stage === "2_homepage_fetch");
  assert.equal(s2.survived, 0, "a failed scrape cannot let a 403 site through");
  const s2Reject = (out.rejects || []).find((r) => r.stage === "2_homepage_fetch" && /http_403/.test(r.reason || ""));
  assert.ok(s2Reject, "the original 403 remains the rejection reason");
  assert.match(s2Reject.detail || "", /firecrawl_scrape_fallback/, "the scrape failure detail is preserved");
});

test("the scrape-fallback cap bounds paid scrapes per run", async () => {
  // Two candidates both 403, but the cap is one scrape.
  const searchTwo = () => new Response(JSON.stringify({
    data: [
      { url: "https://blocked.example/", title: "Blocked Plumbing Co" },
      { url: "https://blocked2.example/", title: "Blocked Plumbing Co 2" },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } });
  const fetchImpl = async (url, options = {}) => {
    const target = typeof url === "string" ? url : String(url);
    const method = (options && options.method) || "GET";
    if (target === SEARCH && method === "POST") return searchTwo();
    if (target === SCRAPE && method === "POST") return scrapeResponse();
    if (target === HOMEPAGE && method === "GET") return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    if (target === "https://blocked2.example/" && method === "GET") return new Response("forbidden", { status: 403, headers: { "content-type": "text/plain" } });
    if (target === SCRAPE && method === "POST") return scrapeResponse();
    return new Response("not found", { status: 404 });
  };
  const out = await mineBuildReady({
    ...baseInput(fetchImpl, { GHOST_AGENCY_MINER_SCRAPE_FALLBACK_LIMIT: "1" }),
    candidatesPerQuery: 4,
  });
  assert.equal(out.cost.homepage_scrape_fallbacks, 1, "the cap must stop a second paid homepage scrape");
});

test("the scrape-fallback kill switch keeps the 403 as a hard stage-2 rejection", async () => {
  const out = await mineBuildReady(baseInput(router({ homepageStatus: 403 }), { GHOST_AGENCY_MINER_SCRAPE_FALLBACK: "0" }));
  assert.equal(out.cost.homepage_scrape_fallbacks, 0, "the kill switch forbids any paid homepage scrape");
  const s2 = out.funnel.find((stage) => stage.stage === "2_homepage_fetch");
  assert.equal(s2.survived, 0);
  assert.ok((s2.rejected.http_403 || 0) >= 1);
});

test("kill-switch and cap helpers parse their env as documented", () => {
  assert.equal(homepageScrapeFallbackEnabled({}), true);
  assert.equal(homepageScrapeFallbackEnabled({ GHOST_AGENCY_MINER_SCRAPE_FALLBACK: "0" }), false);
  // Cost law removed: the default is a generous sanity ceiling (one recovery
  // scrape per candidate site, up to 200 per run), never a spend refusal.
  assert.equal(homepageScrapeFallbackLimit({}), 200);
  assert.equal(homepageScrapeFallbackLimit({ GHOST_AGENCY_MINER_SCRAPE_FALLBACK_LIMIT: "3" }), 3);
  assert.equal(homepageScrapeFallbackLimit({ GHOST_AGENCY_MINER_SCRAPE_FALLBACK_LIMIT: "999" }), 200, "clamped to the sanity ceiling");
  assert.equal(homepageScrapeFallbackLimit({ GHOST_AGENCY_MINER_SCRAPE_FALLBACK_LIMIT: "0" }), 0, "zero disables via cap");
});
