"use strict";

/**
 * test/places-optional-mining.test.js — GOOGLE PLACES IS OPTIONAL (2026-08-25).
 *
 * The billing-recovery spend contract, proved end to end:
 *
 *   1. ZERO Places by default for every lane. Every unspecified, scheduled,
 *      full-run, operator-line and multi-candidate/bulk path dials Google zero
 *      times — key or no key — and only explicit manual_exact may opt in.
 *      Operator-line discovery uses Firecrawl Search and resolves identity
 *      from the first-party website.
 *   2. With no key and one mocked Firecrawl result carrying structured
 *      first-party HTML, the funnel still reaches a buildable record proven by
 *      the REAL mirror-engine dry run (no stubbed renderer on this path).
 *   3. `placesVerify: true` + trigger manual_exact opts one exact candidate
 *      into an OPTIONAL identity lookup, hard-capped to ONE outbound Places
 *      HTTP attempt for the whole run — retries included.
 *   4. A Places billing 4xx on that one attempt is NONTERMINAL: the candidate
 *      falls back to first-party identity and the fallback is recorded.
 *   5. Identity requires separate structured first-party fields
 *      (schema.org name + PostalAddress locality/region). A marketing <title>
 *      like "Plumber in Austin, TX" is market copy, never NAP — title-only
 *      pages are QUARANTINED, and quarantined rows skip opportunity scoring.
 *   6. First-party records carry no Google provenance string anywhere.
 *   7. The identity field mask requests no Atmosphere/photo tiers, and the
 *      Google score axes are cleanly UNMEASURED (absent) for identity-only
 *      observations — never a coerced measured zero.
 *   8. The scheduled mining cron is disabled by default; the env opt-in
 *      re-enables it still at zero Places.
 *   9. Operator-line discovery makes one bounded Firecrawl Search call, emits
 *      one first-party record, and requests zero Places or photo-media URLs.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  mineBuildReady,
  mineLeads,
  persistMinedRows,
  scheduledMiningEnabled,
  firstPartyIdentity,
  firecrawlRenderedJsonLd,
} = require("../lib/lead-miner");
const { runFullSystem } = require("../lib/full-run");

// The REAL dry run stamps client isolation for the fixture slug. Remove the
// stamp when the suite ends so a test run leaves the working tree clean.
test.after(() => {
  fs.rmSync(path.join(__dirname, "..", "artifacts", "clients", "wss-test-flat-plumbing-louisville"), { recursive: true, force: true });
});

const SITE_URL = "https://flatplumbing.example/";
const SIBLING_URL = "https://noaddressplumbing.example/";

// Structured first-party identity: schema.org name + PostalAddress. This is
// the evidence the strict lane REQUIRES.
const FIRST_PARTY_HTML = `<!doctype html><html><head><title>Flat Plumbing Co | Louisville KY</title>
  <meta name="description" content="Plumbing repairs in Louisville KY">
  <script type="application/ld+json">{
    "@type": "LocalBusiness",
    "name": "Flat Plumbing Co",
    "telephone": "(502) 555-0100",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "100 Main St",
      "addressLocality": "Louisville",
      "addressRegion": "KY",
      "postalCode": "40202"
    }
  }</script></head><body>
  <h1>Flat Plumbing Co</h1><p>Plumbing repairs and water heaters in Louisville.</p>
  <section class="services"><h2>Services</h2><h3>Drain Cleaning</h3><h3>Water Heater Repair</h3></section>
  <a href="tel:+15025550100">Call us</a>
  <a href="mailto:flatplumbingco@gmail.com">Email us</a></body></html>`;

// The P0 counterexample: a marketing <title> that names a market, and NOTHING
// structured. The title is not a name, and "Austin, TX" in it is not an
// address — this page must quarantine, never pass with the queried city.
const TITLE_ONLY_HTML = `<!doctype html><html><head><title>Plumber in Austin, TX</title></head><body>
  <h1>Plumber in Austin, TX</h1><p>Plumbing repairs and water heaters.</p>
  <a href="mailto:noaddressplumbing@gmail.com">Email us</a></body></html>`;

// The no-GBP lead identity trust exists for (owner directive 2026-08-31): a
// business with no Google observation and no structured schema — just a name,
// a phone and an email published on its own site. Strict mode quarantined
// this shape; trust mode carries the site's truth and never asks Google.
const NO_SCHEMA_HTML = `<!doctype html><html><head><title>No Address Plumbing Co | Louisville KY</title></head><body>
  <h1>No Address Plumbing Co</h1><p>Plumbing repairs and water heaters.</p>
  <a href="tel:+15025550177">Call (502) 555-0177</a>
  <a href="mailto:noaddressplumbing@gmail.com">Email us</a></body></html>`;

// Structured evidence locating the business in ANOTHER state than the market
// it was mined for.
const WRONG_STATE_HTML = FIRST_PARTY_HTML
  .replace(/Louisville KY/g, "Nashville TN")
  .replace(/Louisville/g, "Nashville")
  .replace(/"addressRegion": "KY"/, '"addressRegion": "TN"');

const RENDERED_IDENTITY = {
  "@type": "LocalBusiness",
  name: "Flat Plumbing Co",
  telephone: "(502) 555-0100",
  address: {
    "@type": "PostalAddress",
    addressLocality: "Louisville",
    addressRegion: "KY",
    postalCode: "40202",
  },
};
const EXPECTED_RENDER_ACTION_SCRIPT = "(()=>{const jsonLd=[];let total=0;for(const node of Array.from(document.querySelectorAll('script[type=\\\"application/ld+json\\\"]')).slice(0,12)){const text=String(node.textContent||'');if(!text)continue;if(text.length>64000||total+text.length>192000)continue;jsonLd.push(text);total+=text.length;}return{finalUrl:String(location.href),jsonLd};})()";
const CLIENT_RENDERED_HTML = `<!doctype html><html><head><title>Flat Plumbing Co | Louisville KY</title></head><body>
  <h1>Flat Plumbing Co</h1><p>Plumbing repairs and water heaters in Louisville.</p>
  <section class="services"><h2>Services</h2><h3>Drain Cleaning</h3><h3>Water Heater Repair</h3></section>
  <a href="tel:+15025550100">Call us</a>
  <a href="mailto:flatplumbingco@gmail.com">Email us</a>
  <script>document.addEventListener("DOMContentLoaded",()=>{/* schema inserted by the client */});</script>
  </body></html>`;

function fixtureFetch({
  counts,
  pages = { [SITE_URL]: FIRST_PARTY_HTML },
  firecrawlResults = null,
  renderedJsonLd = null,
  renderedFinalUrl = null,
  renderedResponse = null,
  placesResponse = null,
  fieldMasks = null,
}) {
  return async (url, init = {}) => {
    const href = String(url && url.url ? url.url : url);
    if (/api\.firecrawl\.dev\/v2\/scrape/i.test(href)) {
      const requested = JSON.parse(String(init.body || "{}"));
      // A branding-format scrape is logo recovery, not identity rendering. It
      // must not trip the rendered-identity action contract below.
      if (Array.isArray(requested.formats) && requested.formats.includes("branding")) {
        counts.firecrawlBranding = (counts.firecrawlBranding || 0) + 1;
        return new Response(JSON.stringify({ success: true, data: { branding: {} } }), { status: 200, headers: { "content-type": "application/json" } });
      }
      counts.firecrawlScrape = (counts.firecrawlScrape || 0) + 1;
      assert.deepEqual(requested.actions, [{
        type: "executeJavascript",
        script: EXPECTED_RENDER_ACTION_SCRIPT,
      }], "rendered identity must use the strict location.href + string-array action contract");
      if (typeof renderedResponse === "function") return renderedResponse(url, init);
      return new Response(JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "object",
            value: {
              finalUrl: renderedFinalUrl || requested.url,
              jsonLd: renderedJsonLd || [],
            },
          }] },
          metadata: { url: renderedFinalUrl || requested.url },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("firecrawl")) {
      counts.firecrawl++;
      const data = firecrawlResults
        || Object.keys(pages).map((u) => ({ url: u, title: "Flat Plumbing Co | Louisville KY" }));
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("places.googleapis.com")) {
      counts.places++;
      if (fieldMasks) fieldMasks.push(String((init.headers || {})["X-Goog-FieldMask"] || ""));
      if (!placesResponse) throw new Error("ZERO-PLACES CONTRACT VIOLATED: a Places request was dispatched");
      return placesResponse();
    }
    const page = pages[href] || pages[`${href}/`];
    if (page) {
      counts.pages++;
      return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
}

// The REAL engine dry run proves these records — mirrorImpl is deliberately
// NOT stubbed anywhere in this file.
function baseInput({
  counts,
  pages,
  firecrawlResults,
  renderedJsonLd,
  renderedFinalUrl,
  renderedResponse,
  placesResponse,
  fieldMasks,
  env = {},
  extra = {},
}) {
  return {
    queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
    candidatesPerQuery: 4,
    env: {
      FIRECRAWL_API_KEY: "firecrawl",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_PHOTO_BANK: "false",
      // IDENTITY TRUST MODE (2026-08-31) is ON by default in production. This
      // suite pins the STRICT lane it replaced, so it opts out via the kill
      // switch; the identity-trust tests below opt back in with "1", and the
      // default-ON behavior itself is pinned in test/metro-fence.test.js.
      GHOST_AGENCY_IDENTITY_TRUST: "0",
      ...env,
    },
    fetchImpl: fixtureFetch({
      counts, pages, firecrawlResults, renderedJsonLd, renderedFinalUrl, renderedResponse,
      placesResponse, fieldMasks,
    }),
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
    ...extra,
  };
}

// mineBuildReady's brand/logo resolution reads global.fetch; pin it to the
// fixture so no test ever performs a real DNS lookup or network call.
async function withGlobalFetch(fetchImpl, run) {
  const real = global.fetch;
  global.fetch = fetchImpl;
  try { return await run(); } finally { global.fetch = real; }
}

function stageByName(funnel, name) {
  return funnel.find((stage) => stage.stage === name);
}

function assertFunnelReconciles(funnel) {
  for (const stage of funnel) {
    const rejected = Object.values(stage.rejected).reduce((a, b) => a + b, 0);
    assert.equal(stage.entered, stage.survived + rejected, `${stage.stage}: entered !== survived + rejected`);
  }
}

function assertFirstPartyRecord(record) {
  const facts = record.mirror_request.facts;
  assert.equal(record.identity_source, "first_party");
  assert.equal(facts.business_name, "Flat Plumbing Co");
  assert.equal(facts.city, "Louisville");
  assert.equal(facts.state, "KY");
  assert.equal(facts.phone, "(502) 555-0100");
  assert.equal(facts.email, "flatplumbingco@gmail.com");
  assert.equal(facts.postal_code, "40202");
  // Domain-bound asset proof stays anchored: the record states its own site.
  assert.equal(facts.current_website, SITE_URL);
  // MAP ABSENCE: no verified geo observation means NO pin — never a guessed one.
  assert.equal(facts.latitude, undefined);
  assert.equal(facts.longitude, undefined);
  assert.equal(facts.place_id, undefined);
  assert.equal(facts.profile_url, undefined);
  // Ratings are third-party trust; the business itself is not an admissible observer.
  assert.equal(facts.rating, undefined);
  assert.equal(facts.review_count, undefined);
  // PROVENANCE NAMES THE REAL OBSERVER — not one Google string anywhere on the
  // emitted record. identity_fallback is the one field that may truthfully
  // name the provider whose failure was recorded, so it is checked separately.
  const { identity_fallback, ...restOfRecord } = record;
  assert.doesNotMatch(JSON.stringify(restOfRecord), /google/i);
  assert.equal(record.provenance.business_name.method, "self_published:schema_org_name");
  assert.equal(record.provenance.state.method, "self_published:schema_postal_address");
  assert.equal(record.provenance.state.metro_fence, "metro_state_match");
  assert.equal(record.provenance.industry.source, "donor_library + first_party_site");
  assert.equal(record.provenance.industry.observer, "wss_miner");
  assert.equal(record.provenance.phone.frozen, true);
  // BRAND GATE PRESERVED: no acceptable own-domain logo exists on this
  // fixture, so the frozen ladder falls to a WORDMARK carrying the
  // self-published verified name — never a foreign image, never a skipped gate.
  assert.equal(record.mirror_request.brand.logo, undefined);
  assert.equal(record.mirror_request.brand.mark.rung, "wordmark");
  assert.equal(record.mirror_request.brand.mark.value.text, "Flat Plumbing Co");
  assert.equal(record.brand_evidence.source, "first_party_site:schema_org_name");
  assert.deepEqual(record.brand_evidence.verified_by, ["self_published_site_name", "frozen_logo_ladder"]);
  // PROVEN BY THE REAL ENGINE: a genuine dry-run build hash, not a stub's.
  assert.equal(record.proof.dry_run_ok, true);
  assert.match(record.proof.build_hash, /^[0-9a-f]{64}$/);
  assert.equal(record.proof.brand_check, "passed");
  assert.ok(record.proof.logo_refs_in_output > 0, "the wordmark must actually render in the dry-run output");
}

test("no Places key at all: one mocked Firecrawl result with structured first-party HTML reaches a real dry-run-proven record", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({ counts });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.places, 0);
  assert.equal(out.cost.places_calls, 0);
  assert.equal(out.cost.firecrawl_scrape_calls, 0, "static JSON-LD must not spend a rendered scrape");
  assert.equal(counts.firecrawlScrape || 0, 0);
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_zero_google");
  assertFirstPartyRecord(out.records[0]);
  assert.equal(out.records[0].identity_fallback, undefined, "no provider was attempted, so no fallback is claimed");
  // normalizeIdentityToken strips corporate stopwords ("co"), by design.
  assert.equal(out.records[0].slug, "wss-test-flat-plumbing-louisville");
  assertFunnelReconciles(out.funnel);
});

test("a free-gate rejection spends zero rendered scrapes", async () => {
  const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: CLIENT_RENDERED_HTML },
    renderedJsonLd: [JSON.stringify(RENDERED_IDENTITY)],
    env: { GHOST_AGENCY_LOGO_LADDER_FALLBACK: "0" },
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.records.length, 0);
  const brandStage = stageByName(out.funnel, "4_brand_logo_and_accent");
  assert.equal(brandStage.entered, 1);
  assert.equal(brandStage.survived, 0);
  assert.equal(Object.values(brandStage.rejected).reduce((sum, count) => sum + count, 0), 1);
  assert.equal(counts.firecrawlScrape, 0, "a stage-4 refusal must happen before paid identity rendering");
  assert.equal(out.cost.firecrawl_scrape_calls, 0);
  assert.equal(stageByName(out.funnel, "6_nap_verification").entered, 0);
  assertFunnelReconciles(out.funnel);
});

test("manual_exact uses an authorised Places identity before rendered fallback", async () => {
  const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
  const place = {
    id: "place-flat-plumbing",
    displayName: { text: "Flat Plumbing Co" },
    nationalPhoneNumber: "(502) 555-0100",
    websiteUri: SITE_URL,
    primaryType: "plumber",
    types: ["plumber"],
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=42",
    addressComponents: [
      { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
      { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
      { types: ["postal_code"], longText: "40202", shortText: "40202" },
    ],
  };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: CLIENT_RENDERED_HTML },
    renderedJsonLd: [JSON.stringify(RENDERED_IDENTITY)],
    placesResponse: () => new Response(JSON.stringify({ places: [place] }), {
      status: 200, headers: { "content-type": "application/json" },
    }),
    // Pre-maps scrape-count pin; the Maps lane is pinned in its own file.
    env: { GOOGLE_PLACES_API_KEY: "places", GHOST_AGENCY_MAPS_DISCOVERY: "0" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1 },
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records[0].identity_source, "google_places");
  assert.equal(counts.places, 1);
  assert.equal(out.cost.places_calls, 1);
  assert.equal(counts.firecrawlScrape, 0, "a successful Places identity must end the fallback ladder");
  assert.equal(out.cost.firecrawl_scrape_calls, 0);
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "google_places");
  assertFunnelReconciles(out.funnel);
});

test("client-rendered first-party JSON-LD is recovered by one bounded Firecrawl scrape", async () => {
  const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: CLIENT_RENDERED_HTML },
    renderedJsonLd: [JSON.stringify(RENDERED_IDENTITY)],
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.firecrawlScrape, 1);
  assert.equal(out.cost.firecrawl_scrape_calls, 1);
  assertFirstPartyRecord(out.records[0]);
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_plus_firecrawl_render");
  assertFunnelReconciles(out.funnel);
});

test("two eligible survivors each get their own rendered scrape — the old single-render run cap no longer refuses the second", async () => {
  const secondUrl = "https://secondplumbing.example/";
  const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
  const renderedUrls = [];
  const input = baseInput({
    counts,
    pages: {
      [SITE_URL]: CLIENT_RENDERED_HTML,
      [secondUrl]: CLIENT_RENDERED_HTML
        .replaceAll("Flat Plumbing Co", "Second Plumbing Co")
        .replaceAll("flatplumbingco@gmail.com", "secondplumbing@gmail.com"),
    },
    firecrawlResults: [
      { url: SITE_URL, title: "Flat Plumbing Co | Louisville KY" },
      { url: secondUrl, title: "Second Plumbing Co | Louisville KY" },
    ],
    renderedResponse: (_url, init) => {
      const requested = JSON.parse(String(init.body || "{}"));
      renderedUrls.push(requested.url);
      return new Response(JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "object",
            value: { finalUrl: requested.url, jsonLd: [JSON.stringify(RENDERED_IDENTITY)] },
          }] },
          metadata: { url: requested.url },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  // Cost law removed: the rendered-identity lane once held a literal ONE
  // scrape per run; it is now one rendered scrape per candidate site under a
  // generous sanity ceiling, so both survivors are proved.
  assert.equal(counts.firecrawlScrape, 2);
  assert.equal(out.cost.firecrawl_scrape_calls, 2);
  assert.deepEqual(renderedUrls, [SITE_URL, secondUrl], "each eligible survivor must receive its own render");
  assert.equal(out.records.length, 2, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.held_rows.length, 0, "no eligible survivor is refused for spend");
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_plus_firecrawl_render");
  assertFunnelReconciles(out.funnel);
});

test("a failed rendered attempt no longer spends a shared run allowance — each survivor still gets and fails on its own attempt", async () => {
  const secondUrl = "https://secondplumbing.example/";
  const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
  const renderedUrls = [];
  const input = baseInput({
    counts,
    pages: {
      [SITE_URL]: CLIENT_RENDERED_HTML,
      [secondUrl]: CLIENT_RENDERED_HTML
        .replaceAll("Flat Plumbing Co", "Second Plumbing Co")
        .replaceAll("flatplumbingco@gmail.com", "secondplumbing@gmail.com"),
    },
    firecrawlResults: [
      { url: SITE_URL, title: "Flat Plumbing Co | Louisville KY" },
      { url: secondUrl, title: "Second Plumbing Co | Louisville KY" },
    ],
    renderedResponse: (_url, init) => {
      const requested = JSON.parse(String(init.body || "{}"));
      renderedUrls.push(requested.url);
      return new Response(JSON.stringify({ error: "upstream unavailable" }), {
        status: 503, headers: { "content-type": "application/json" },
      });
    },
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(counts.firecrawlScrape, 2, "each failed provider attempt is still metered on the ledger");
  assert.equal(out.cost.firecrawl_scrape_calls, 2);
  assert.deepEqual(renderedUrls, [SITE_URL, secondUrl], "the second survivor must receive its own attempt rather than being refused by a spent cap");
  assert.equal(out.records.length, 0);
  assert.equal(out.held_rows.length, 2);
  assert.deepEqual(out.held_rows.map((row) => row.current_website), [SITE_URL, secondUrl]);
  assert.ok(out.held_rows.every((row) => row.record.blocked_reason === "identity_unverified_first_party"));
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_plus_firecrawl_render");
  assertFunnelReconciles(out.funnel);
});

test("Places failure plus rendered success meters and labels both provider attempts", async () => {
  const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: CLIENT_RENDERED_HTML },
    renderedJsonLd: [JSON.stringify(RENDERED_IDENTITY)],
    placesResponse: () => new Response(JSON.stringify({
      error: { code: 403, message: "PERMISSION_DENIED: billing disabled", status: "PERMISSION_DENIED" },
    }), { status: 403, headers: { "content-type": "application/json" } }),
    // Pre-maps scrape-count pin; the Maps lane is pinned in its own file.
    env: { GOOGLE_PLACES_API_KEY: "places", GHOST_AGENCY_MAPS_DISCOVERY: "0" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1 },
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  assertFirstPartyRecord(out.records[0]);
  assert.equal(out.records[0].identity_fallback.from, "google_places");
  assert.equal(counts.places, 1);
  assert.equal(counts.firecrawlScrape, 1);
  assert.equal(out.cost.places_calls, 1);
  assert.equal(out.cost.firecrawl_scrape_calls, 1);
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "google_places_plus_firecrawl_render");
  assertFunnelReconciles(out.funnel);
});

test("rendered JSON-LD fallback refuses foreign owners and malformed action output", async (t) => {
  await t.test("foreign final URL", async () => {
    const result = await firecrawlRenderedJsonLd({
      url: SITE_URL,
      apiKey: "firecrawl",
      fetchImpl: async () => new Response(JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "object",
            value: { finalUrl: "https://foreign.example/", jsonLd: [JSON.stringify(RENDERED_IDENTITY)] },
          }] },
          metadata: { url: "https://foreign.example/" },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "firecrawl_render_cross_owner");
    assert.deepEqual(result.nodes, []);
  });

  await t.test("malformed action value", async () => {
    const result = await firecrawlRenderedJsonLd({
      url: SITE_URL,
      apiKey: "firecrawl",
      fetchImpl: async () => new Response(JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "object",
            value: { finalUrl: SITE_URL, jsonLd: ["not-json"] },
          }] },
          metadata: { url: SITE_URL },
        },
      }), { status: 200, headers: { "content-type": "application/json" } }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "firecrawl_render_jsonld_invalid");
    assert.deepEqual(result.nodes, []);
  });
});

test("rendered helper enforces the exact request and hostile-response contract", async (t) => {
  await t.test("strict request contract", async () => {
    let requested;
    const result = await firecrawlRenderedJsonLd({
      url: SITE_URL,
      apiKey: "firecrawl",
      fetchImpl: async (_url, init) => {
        requested = JSON.parse(String(init.body || "{}"));
        return new Response(JSON.stringify({
          success: true,
          data: {
            actions: { javascriptReturns: [{
              type: "object",
              value: { finalUrl: SITE_URL, jsonLd: [JSON.stringify(RENDERED_IDENTITY)] },
            }] },
            metadata: { url: SITE_URL },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(requested, {
      url: SITE_URL,
      formats: ["markdown"],
      onlyMainContent: false,
      timeout: 20_000,
      storeInCache: false,
      actions: [{ type: "executeJavascript", script: EXPECTED_RENDER_ACTION_SCRIPT }],
    });
  });

  const validText = JSON.stringify(RENDERED_IDENTITY);
  const hostile = [
    {
      name: "metadata sourceURL cannot replace action finalUrl",
      body: JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{ type: "object", value: { jsonLd: [validText] } }] },
          metadata: { sourceURL: SITE_URL },
        },
      }),
      reason: "firecrawl_render_schema_invalid",
    },
    {
      name: "already-parsed identity object injection",
      body: JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "object", value: { finalUrl: SITE_URL, jsonLd: [RENDERED_IDENTITY] },
          }] },
        },
      }),
      reason: "firecrawl_render_schema_invalid",
    },
    {
      name: "success false",
      body: JSON.stringify({
        success: false,
        data: {
          actions: { javascriptReturns: [{
            type: "object", value: { finalUrl: SITE_URL, jsonLd: [validText] },
          }] },
        },
      }),
      reason: "firecrawl_render_schema_invalid",
    },
    {
      name: "wrong result type",
      body: JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "string", value: { finalUrl: SITE_URL, jsonLd: [validText] },
          }] },
        },
      }),
      reason: "firecrawl_render_schema_invalid",
    },
    {
      name: "extra payload schema",
      body: JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{
            type: "object", value: { finalUrl: SITE_URL, jsonLd: [validText], extra: true },
          }] },
        },
      }),
      reason: "firecrawl_render_schema_invalid",
    },
    {
      name: "oversized decompressed response",
      body: "x".repeat(600_000),
      reason: "firecrawl_render_response_too_large",
    },
  ];
  for (const scenario of hostile) {
    await t.test(scenario.name, async () => {
      const result = await firecrawlRenderedJsonLd({
        url: SITE_URL,
        apiKey: "firecrawl",
        fetchImpl: async () => new Response(scenario.body, {
          status: 200, headers: { "content-type": "application/json" },
        }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, scenario.reason);
      assert.deepEqual(result.nodes, []);
      assert.equal(result.calls, 1);
    });
  }
});

test("hostile rendered response shapes fail closed through the production funnel", async (t) => {
  const validText = JSON.stringify(RENDERED_IDENTITY);
  const scenarios = [
    {
      name: "sourceURL only",
      body: JSON.stringify({
        success: true,
        data: {
          actions: { javascriptReturns: [{ type: "object", value: { jsonLd: [validText] } }] },
          metadata: { sourceURL: SITE_URL },
        },
      }),
    },
    {
      name: "object value injection",
      body: JSON.stringify({
        success: true,
        data: { actions: { javascriptReturns: [{
          type: "object", value: { finalUrl: SITE_URL, jsonLd: [RENDERED_IDENTITY] },
        }] } },
      }),
    },
    {
      name: "success false",
      body: JSON.stringify({
        success: false,
        data: { actions: { javascriptReturns: [{
          type: "object", value: { finalUrl: SITE_URL, jsonLd: [validText] },
        }] } },
      }),
    },
    { name: "oversized response", body: "x".repeat(600_000) },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
      const input = baseInput({
        counts,
        pages: { [SITE_URL]: CLIENT_RENDERED_HTML },
        renderedResponse: () => new Response(scenario.body, {
          status: 200, headers: { "content-type": "application/json" },
        }),
      });
      const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
      assert.equal(counts.firecrawlScrape, 1);
      assert.equal(out.cost.firecrawl_scrape_calls, 1);
      assert.equal(out.records.length, 0, "hostile provider output must never mint identity");
      assert.equal(out.held_rows.length, 1);
      assert.equal(out.held_rows[0].record.blocked_reason, "identity_unverified_first_party");
      assertFunnelReconciles(out.funnel);
    });
  }
});

test("foreign and malformed rendered output fail closed through the production funnel", async (t) => {
  const scenarios = [
    { name: "foreign owner", renderedFinalUrl: "https://foreign.example/" },
    { name: "malformed JSON-LD", renderedJsonLd: ["not-json"] },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const counts = { firecrawl: 0, firecrawlScrape: 0, places: 0, pages: 0 };
      const input = baseInput({
        counts,
        pages: { [SITE_URL]: CLIENT_RENDERED_HTML },
        renderedJsonLd: scenario.renderedJsonLd || [JSON.stringify(RENDERED_IDENTITY)],
        renderedFinalUrl: scenario.renderedFinalUrl,
      });

      const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

      assert.equal(counts.firecrawlScrape, 1);
      assert.equal(out.cost.firecrawl_scrape_calls, 1);
      assert.equal(out.records.length, 0, "untrusted rendered bytes must never mint identity");
      assert.equal(out.held_rows.length, 1);
      assert.equal(out.held_rows[0].record.blocked_reason, "identity_unverified_first_party");
      assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_plus_firecrawl_render");
      assertFunnelReconciles(out.funnel);
    });
  }
});

test("rendered JSON-LD parsing hard-caps a giant @graph at 100 nodes", async () => {
  const graph = Array.from({ length: 250 }, (_, index) => ({ "@type": "Thing", name: `Node ${index}` }));
  const result = await firecrawlRenderedJsonLd({
    url: SITE_URL,
    apiKey: "firecrawl",
    fetchImpl: async () => new Response(JSON.stringify({
      success: true,
      data: {
        actions: { javascriptReturns: [{
          type: "object",
          value: { finalUrl: SITE_URL, jsonLd: [JSON.stringify({ "@graph": graph })] },
        }] },
        metadata: { url: SITE_URL },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.nodes.length, 100, "the @graph root and children must never exceed the hard node cap");
});

test("multi-candidate bulk path ignores placesVerify: zero Places, sibling survives, weak candidate quarantines", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: FIRST_PARTY_HTML, [SIBLING_URL]: TITLE_ONLY_HTML },
    firecrawlResults: [
      { url: SITE_URL, title: "Flat Plumbing Co | Louisville KY" },
      { url: SIBLING_URL, title: "Plumber in Louisville KY" },
    ],
    // The zero-Places contract: any hit on places.googleapis.com throws.
    env: { GOOGLE_PLACES_API_KEY: "a-real-key-that-must-never-be-dialed" },
    // placesVerify on a multi-candidate shape buys nothing: the opt-in is
    // valid only for an exact single-candidate request.
    extra: { placesVerify: true },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.places, 0, "a multi-candidate run dialed Google despite the shape rule");
  assert.equal(out.cost.places_calls, 0);
  assert.equal(out.cost.places_photo_media_calls, 0);

  // The structured sibling survives on its own evidence…
  assert.equal(out.records.length, 1);
  assertFirstPartyRecord(out.records[0]);
  // …and the evidence-free sibling is quarantined, not failed silently and not
  // passed with the queried city.
  assert.equal(out.held_rows.length, 1);
  const held = out.held_rows[0];
  assert.equal(held.status, "held");
  assert.equal(held.record.blocked_reason, "identity_unverified_first_party");
  assert.equal(held.city, null, "never defaulted from the query");
  assert.equal(held.state, null, "never defaulted from the query");
  const s6 = stageByName(out.funnel, "6_nap_verification");
  assert.equal(s6.entered, 2);
  assert.equal(s6.survived, 1);
  assert.equal(s6.rejected.identity_unverified_first_party, 1);
  assertFunnelReconciles(out.funnel);

  // PERSISTENCE: the surviving sibling is scored and written; the quarantined
  // row routes AROUND opportunity scoring and is surfaced, untouched.
  const { rowFromBuildReady } = require("../lib/lead-miner");
  const goodRow = rowFromBuildReady(out.records[0], { textQuery: "plumbing in Louisville KY" });
  const persisted = await persistMinedRows({
    rows: [goodRow, held], persist: false, actor: "test", trigger: "test", selectCount: 5,
  });
  assert.equal(persisted.scored.rows.length, 1, "only the verified sibling enters the sendable ranking");
  assert.equal(persisted.scored.rows[0].prospect_id, goodRow.prospect_id);
  assert.equal(persisted.rows.length, 2, "the hold is still surfaced to the operator beside its sibling");
});

test("title-only 'Plumber in Austin, TX' is quarantined: a marketing title is never a name and never an address", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SIBLING_URL]: TITLE_ONLY_HTML.replace(/Louisville KY/g, "Austin, TX") },
    firecrawlResults: [{ url: SIBLING_URL, title: "Plumber in Austin, TX" }],
    extra: { queries: [{ industry: "plumbing", location: "Austin TX", textQuery: "plumbing in Austin TX", queryGroup: 0 }] },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0, "a title-only page must never build");
  assert.equal(counts.places, 0);
  assert.equal(out.held_rows.length, 1);
  assert.equal(out.held_rows[0].record.blocked_reason, "identity_unverified_first_party");
  assert.deepEqual(out.held_rows[0].record.identity_hold.missing, ["business_name", "locality", "state"]);
  const reject = out.rejects.find((r) => r.reason === "identity_unverified_first_party");
  assert.match(reject.detail, /schema\.org name \+ PostalAddress required/);
  assertFunnelReconciles(out.funnel);
});

test("structured first-party evidence naming another state refuses on the standard metro fence", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({ counts, pages: { [SITE_URL]: WRONG_STATE_HTML } });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0);
  assert.equal(out.held_rows.length, 0, "a fence violation is a refusal, not a review hold");
  const s6 = stageByName(out.funnel, "6_nap_verification");
  assert.equal(s6.rejected.out_of_metro_state, 1);
  const reject = out.rejects.find((r) => r.reason === "out_of_metro_state");
  assert.match(reject.detail, /queried Louisville KY -> resolved Nashville TN/);
  assertFunnelReconciles(out.funnel);
});

// ---------------------------------------------------------------------------
// IDENTITY TRUST MODE (owner directive 2026-08-31).
//
// TRUST THE SITE: whatever NAP the business's own site carries is good, a
// human corrects the rest over the phone, and Google Places is OPTIONAL
// enrichment — a business with no Google observation is an underserved lead,
// not a defect. An incomplete site identity is not a failure being
// suppressed, so those rows pass with NO override tag; the one refusal trust
// genuinely overrides — the metro fence — is the one that rides the row as
// identity_trust_overridden:out_of_metro_state. The kill switch
// GHOST_AGENCY_IDENTITY_TRUST=0 restores every quarantine and refusal this
// suite pins above, exactly.
// ---------------------------------------------------------------------------

const mirrorPassTrust = async () => ({
  ok: true, status: 200,
  body: {
    ok: true, build_hash: "hash", donor_content_hash: "donor", file_count: 51,
    evidence_sha: "sha", renderer: "mirror-engine@v1",
    checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
  },
});

test("identity trust: a no-GBP, no-schema site passes clean — site truth carried, no tag", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: NO_SCHEMA_HTML },
    firecrawlResults: [{ url: SITE_URL, title: "No Address Plumbing Co | Louisville KY" }],
    env: { GHOST_AGENCY_IDENTITY_TRUST: "1" },
    extra: { mirrorImpl: mirrorPassTrust },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.held_rows.length, 0, "an incomplete site identity is not a review hold in trust mode");
  const record = out.records[0];

  // NOT AN OVERRIDDEN FAILURE: strict mode called this shape
  // identity_unverified_first_party; trust mode simply stops asking, so no
  // override tag exists to suppress.
  assert.equal(record.identity_trust_overrides, undefined);
  assert.equal(record.identity_source, "first_party");

  // SITE TRUTH: the name, the phone and the email the site itself publishes.
  const facts = record.mirror_request.facts;
  assert.equal(facts.business_name, "No Address Plumbing Co");
  assert.equal(facts.phone, "+15025550177");
  assert.equal(record.provenance.business_name.method, "self_published:html_h1_trust");
  assert.equal(record.provenance.phone.method, "self_published:tel_link");

  // The queried market rides as the LABELLED hint for the fields the site did
  // not publish — never a silent postal claim.
  assert.equal(facts.city, "Louisville");
  assert.equal(facts.state, "KY");
  assert.equal(record.provenance.city.class, "provisional");
  assert.equal(record.provenance.city.method, "identity_trust_mode");
  assert.equal(record.provenance.city.source, "queried_market_hint");
  assert.equal(record.provenance.state.method, "identity_trust_mode");
  assert.equal(record.metro_fence.basis, "identity_trust_market_hint");

  // ZERO GOOGLE, BY CONSTRUCTION: no GBP was ever needed, and none was dialed.
  assert.equal(counts.places, 0);
  assert.deepEqual(out.provider_health, { mode: "skipped_zero_google" });

  // THE SITE'S SCRAPED EMAIL ROUTES THE NEW SITE'S CONTACT FORM — this is the
  // exact facts.email the built site's wss-lead-config reads for the form's
  // mailto: fallback (see mirror-lead-capture.test.js for the form side).
  assert.equal(facts.email, "noaddressplumbing@gmail.com");
  assert.equal(record.email_evidence.email, "noaddressplumbing@gmail.com");
  assertFunnelReconciles(out.funnel);
});

test("identity trust: the strict no-schema quarantine is restored exactly by the kill switch", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: NO_SCHEMA_HTML },
    firecrawlResults: [{ url: SITE_URL, title: "No Address Plumbing Co | Louisville KY" }],
    // baseInput's default is already "0"; stated here because this test IS
    // the reversibility contract.
    env: { GHOST_AGENCY_IDENTITY_TRUST: "0" },
    extra: { mirrorImpl: mirrorPassTrust },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0, "strict mode quarantines the no-schema site exactly as before");
  assert.equal(out.held_rows.length, 1);
  assert.equal(out.held_rows[0].record.blocked_reason, "identity_unverified_first_party");
  assert.deepEqual(out.held_rows[0].record.identity_hold.missing, ["business_name", "locality", "state"]);
  assertFunnelReconciles(out.funnel);
});

test("identity trust: an out-of-metro site keeps its own market, tagged for audit", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: WRONG_STATE_HTML },
    env: { GHOST_AGENCY_IDENTITY_TRUST: "1" },
    extra: { mirrorImpl: mirrorPassTrust },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records.length, 1, JSON.stringify(out.rejects || []).slice(0, 600));
  const record = out.records[0];

  // The one refusal trust genuinely overrides rides the row for audit.
  assert.deepEqual(record.identity_trust_overrides, ["identity_trust_overridden:out_of_metro_state"]);
  // THE SITE'S OWN MARKET WINS — never the one we queried.
  assert.equal(record.mirror_request.facts.state, "TN");
  assert.equal(record.mirror_request.facts.city, "Nashville");
  assert.equal(record.identity_source, "first_party");
  assert.equal(record.metro_fence.basis, "identity_trust_overridden");
  assert.equal(record.metro_fence.trust.overridden, "out_of_metro_state");
  assert.match(record.metro_fence.trust.original_detail, /queried Louisville KY -> resolved Nashville TN/);
  // The stamp reaches the provenance the packet is audited from.
  assert.equal(record.provenance.state.metro_fence, "identity_trust_overridden");
  assert.equal(record.provenance.state.mined_for, "Louisville, KY");
  // Nobody was rejected at the identity stage: the refusal became a warning.
  assert.deepEqual(stageByName(out.funnel, "6_nap_verification").rejected, {});
  assertFunnelReconciles(out.funnel);
});

test("identity trust: a Places healthy-NO is a non-event — the opted-in lane proceeds on site truth", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    placesResponse: () => new Response(JSON.stringify({ places: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    env: { GOOGLE_PLACES_API_KEY: "places", GHOST_AGENCY_IDENTITY_TRUST: "1" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1, mirrorImpl: mirrorPassTrust },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.places, 1, "the opted-in lookup still runs and still bills its one attempt");
  assert.equal(out.records.length, 1, "no Google observation is not a refusal in trust mode");
  const record = out.records[0];
  assert.equal(record.identity_source, "first_party");
  assert.equal(record.identity_trust_overrides, undefined, "Places absence is not a failure, so it carries no tag");
  assert.equal(record.identity_fallback.from, "google_places");
  assert.equal(record.identity_fallback.reason, "nap_not_found_for_domain");
  assert.equal(record.mirror_request.facts.business_name, "Flat Plumbing Co");
  assertFunnelReconciles(out.funnel);
});

test("strict mode keeps the Places healthy-NO refusal — the kill switch is exact", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    placesResponse: () => new Response(JSON.stringify({ places: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    env: { GOOGLE_PLACES_API_KEY: "places" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1, mirrorImpl: mirrorPassTrust },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0);
  assert.equal(out.held_rows.length, 0, "a healthy-NO was a refusal, not a hold, in strict mode");
  assert.equal(stageByName(out.funnel, "6_nap_verification").rejected.nap_not_found_for_domain, 1);
  assertFunnelReconciles(out.funnel);
});

test("identity trust: a matching Google observation still enriches — Places presence is optional, never ignored", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const place = {
    id: "place-flat-plumbing",
    displayName: { text: "Flat Plumbing Co" },
    formattedAddress: "100 Main St, Louisville, KY 40202, USA",
    location: { latitude: 38.2527, longitude: -85.7585 },
    nationalPhoneNumber: "(502) 555-0100",
    websiteUri: SITE_URL,
    primaryType: "plumber",
    types: ["plumber", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=42",
    addressComponents: [
      { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
      { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
      { types: ["postal_code"], longText: "40202", shortText: "40202" },
    ],
  };
  const input = baseInput({
    counts,
    placesResponse: () => new Response(JSON.stringify({ places: [place] }), { status: 200, headers: { "content-type": "application/json" } }),
    env: { GOOGLE_PLACES_API_KEY: "places", GHOST_AGENCY_IDENTITY_TRUST: "1" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1, mirrorImpl: mirrorPassTrust },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records.length, 1);
  const record = out.records[0];
  assert.equal(record.identity_source, "google_places", "a GBP that matches the domain still supplies the identity");
  assert.equal(record.mirror_request.facts.place_id, "place-flat-plumbing");
  assert.equal(record.identity_trust_overrides, undefined, "an enriched identity passed every gate — nothing was overridden");
  assert.equal(record.identity_fallback, undefined);
  assertFunnelReconciles(out.funnel);
});

test("opted-in exact candidate: one query, zero retries — at most ONE outbound attempt, nonterminal fallback", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    // A 503 is retryable in the shared provider code; the opted-in lookup runs
    // with retries:0 so exactly one attempt leaves the machine.
    placesResponse: () => new Response(JSON.stringify({ error: "upstream" }), { status: 503, headers: { "content-type": "application/json" } }),
    env: { GOOGLE_PLACES_API_KEY: "places" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1 },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.places, 1, "the whole request is capped to ONE outbound Places HTTP attempt — retries included");
  assert.equal(out.cost.places_calls, 1, "the ledger bills exactly the attempt that left the machine");
  assert.equal(out.records.length, 1, "a provider failure must never kill the lead");
  assertFirstPartyRecord(out.records[0]);
  assert.equal(out.records[0].identity_fallback.from, "google_places");
  const s6 = stageByName(out.funnel, "6_nap_verification");
  assert.deepEqual(s6.rejected, {}, "nonterminal means nonterminal: the provider failure rejects nobody");
  assertFunnelReconciles(out.funnel);
});

test("a Places billing 4xx on the one attempt is nonterminal and recorded on the record", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const input = baseInput({
    counts,
    placesResponse: () => new Response(JSON.stringify({
      error: { code: 403, message: "PERMISSION_DENIED: billing disabled", status: "PERMISSION_DENIED" },
    }), { status: 403, headers: { "content-type": "application/json" } }),
    env: { GOOGLE_PLACES_API_KEY: "key-with-broken-billing" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1 },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.places, 1, "a 4xx is not retryable — exactly one request left the machine");
  assert.equal(out.records.length, 1);
  assertFirstPartyRecord(out.records[0]);
  assert.equal(out.records[0].identity_fallback.from, "google_places");
  assert.equal(out.records[0].identity_fallback.reason, "places_error");
});

test("the opted-in identity lookup requests no Atmosphere or photo fields, and its score axes stay unmeasured", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const fieldMasks = [];
  // An identity-mask response: NAP fields only, none of the trust tiers.
  const place = {
    id: "place-flat-plumbing",
    displayName: { text: "Flat Plumbing Co" },
    formattedAddress: "100 Main St, Louisville, KY 40202, USA",
    location: { latitude: 38.2527, longitude: -85.7585 },
    nationalPhoneNumber: "(502) 555-0100",
    websiteUri: SITE_URL,
    primaryType: "plumber",
    types: ["plumber", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=42",
    addressComponents: [
      { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
      { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
      { types: ["postal_code"], longText: "40202", shortText: "40202" },
    ],
  };
  const input = baseInput({
    counts,
    fieldMasks,
    placesResponse: () => new Response(JSON.stringify({ places: [place] }), { status: 200, headers: { "content-type": "application/json" } }),
    env: { GOOGLE_PLACES_API_KEY: "places" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1 },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(counts.places, 1);
  assert.equal(out.records.length, 1);
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "google_places",
    "the opted-in lane's stage 6 cost label names the provider it used");
  const record = out.records[0];
  assert.equal(record.identity_source, "google_places");
  assert.equal(record.mirror_request.facts.place_id, "place-flat-plumbing");

  // THE MASK: identity fields only, never the expensive tiers.
  assert.ok(fieldMasks.length > 0, "the mask must have been captured");
  for (const mask of fieldMasks) {
    for (const requiredField of ["places.id", "places.displayName", "places.addressComponents", "places.googleMapsUri"]) {
      assert.ok(mask.includes(requiredField), `identity mask must request ${requiredField}`);
    }
    for (const banned of [
      "places.reviews", "places.rating", "places.userRatingCount",
      "places.regularOpeningHours", "places.editorialSummary", "places.photos",
    ]) {
      assert.ok(!mask.includes(banned), `identity mask must not request ${banned} (expensive tier)`);
    }
  }

  // UNMEASURED, NOT ZERO: the observation never measured the trust fields, so
  // no Google score axis may exist on the qualification — a coerced measured
  // zero would bias the composite toward admitting leads it should refuse.
  assert.doesNotMatch(JSON.stringify(record.qualification.categories), /google_places|reputation/);
  // And the trust PAIR is absent from the facts, not defaulted.
  assert.equal(record.mirror_request.facts.rating, undefined);
  assert.equal(record.mirror_request.facts.review_count, undefined);
});

test("a Google identity with generic types does not falsely claim Google trade corroboration", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const place = {
    id: "place-flat-plumbing-generic",
    displayName: { text: "Flat Plumbing Co" },
    formattedAddress: "100 Main St, Louisville, KY 40202, USA",
    nationalPhoneNumber: "(502) 555-0100",
    websiteUri: SITE_URL,
    primaryType: "point_of_interest",
    types: ["point_of_interest", "establishment"],
    businessStatus: "OPERATIONAL",
    addressComponents: [
      { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
      { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
      { types: ["postal_code"], longText: "40202", shortText: "40202" },
    ],
  };
  const input = baseInput({
    counts,
    placesResponse: () => new Response(JSON.stringify({ places: [place] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    env: { GOOGLE_PLACES_API_KEY: "places" },
    extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery: 1 },
  });

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.records.length, 1);
  assert.equal(out.records[0].identity_source, "google_places");
  assert.equal(out.records[0].provenance.industry.source, "donor_library + first_party_site");
  assert.equal(out.records[0].provenance.industry.observer, "wss_miner");
  assert.equal(out.records[0].provenance.industry.method, "corroboration:self_published_only");
  assert.equal(out.records[0].provenance.industry.retrieval_method, "direct_fetch");
});

test("full_run path: zero Places calls even with a key exported", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const saved = {};
  for (const k of ["GOOGLE_PLACES_API_KEY", "FIRECRAWL_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    saved[k] = process.env[k];
  }
  process.env.GOOGLE_PLACES_API_KEY = "a-real-key-that-must-never-be-dialed";
  process.env.FIRECRAWL_API_KEY = "firecrawl";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const fetchImpl = fixtureFetch({ counts, firecrawlResults: [] });
  try {
    const result = await withGlobalFetch(fetchImpl, () => runFullSystem({
      category: "plumbing",
      location: "Louisville KY",
      count: 2,
      dryRun: true,
    }));
    assert.equal(counts.places, 0, "full_run dialed Google Places");
    assert.ok(counts.firecrawl >= 1, "full_run must still discover through Firecrawl");
    assert.ok(result.runId, "the run completed its mined stage rather than crashing");
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test("scheduled mining is disabled by default: zero mining, provider and Census calls (audit records remain)", async () => {
  assert.equal(scheduledMiningEnabled({}), false);
  assert.equal(scheduledMiningEnabled({ GHOST_AGENCY_SCHEDULED_MINING: "true" }), true);
  const out = await mineLeads({
    verticals: "plumbing",
    metros: "Louisville KY",
    limit: 4,
    persist: false,
    trigger: "scheduled_cron",
    env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k" },
    fetchImpl: async () => { throw new Error("a disabled cron must make zero mining/provider/Census calls"); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.mode, "scheduled_mining_disabled");
});

test("the env opt-in re-enables the cron lane — still zero Places, even against placesVerify", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const fetchImpl = fixtureFetch({ counts });
  const out = await withGlobalFetch(fetchImpl, () => mineLeads({
    verticals: "plumbing",
    metros: "Louisville KY",
    limit: 4,
    persist: false,
    trigger: "scheduled_cron",
    candidatesPerQuery: 4,
    placesVerify: true, // a scheduled run may not buy its way in
    env: {
      GHOST_AGENCY_SCHEDULED_MINING: "true",
      GOOGLE_PLACES_API_KEY: "a-real-key-that-must-never-be-dialed",
      FIRECRAWL_API_KEY: "firecrawl",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_PHOTO_BANK: "false",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
  }));
  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 600));
  assert.equal(out.mode, "build_ready");
  assert.equal(counts.places, 0, "the re-enabled cron lane still never dials Google");
  assert.equal(out.cost.places_calls, 0);
  assert.equal(out.rows.length, 1);
});

test("firstPartyIdentity: structured schema evidence only — titles, og tags and market claims are never identity", () => {
  const good = firstPartyIdentity({
    html: FIRST_PARTY_HTML,
    ldNodes: [{ "@type": "LocalBusiness", name: "Flat Plumbing Co", telephone: "(502) 555-0100", address: { addressLocality: "Louisville", addressRegion: "KY", postalCode: "40202" } }],
    url: SITE_URL,
  });
  assert.equal(good.ok, true);
  assert.equal(good.identity.locality, "Louisville");
  assert.equal(good.identity.state, "KY");
  assert.equal(good.identity.nameSurface, "schema_org_name");
  assert.equal(good.identity.phoneSurface, "schema_org_telephone");
  assert.equal(good.identity.place, null);

  // Title-only: no structured name, no structured address — everything missing.
  const titleOnly = firstPartyIdentity({ html: TITLE_ONLY_HTML, ldNodes: [], url: SIBLING_URL });
  assert.equal(titleOnly.ok, false);
  assert.equal(titleOnly.reason, "identity_unverified_first_party");
  assert.deepEqual(titleOnly.missing, ["business_name", "locality", "state"]);

  // A schema name with a market claim but NO PostalAddress: the market claim
  // must not stand in for an address.
  const nameNoAddress = firstPartyIdentity({
    html: "",
    ldNodes: [{ "@type": "LocalBusiness", name: "Flat Plumbing Co", areaServed: "Austin, TX" }],
    url: SIBLING_URL,
  });
  assert.equal(nameNoAddress.ok, false);
  assert.deepEqual(nameNoAddress.missing, ["locality", "state"]);

  // Extraction is truthful even when the state will later fail the fence —
  // fencing is the fence's job, not the extractor's.
  const otherState = firstPartyIdentity({
    html: "",
    ldNodes: [{ "@type": "LocalBusiness", name: "Flat Plumbing Co", address: { addressLocality: "Nashville", addressRegion: "TN" } }],
    url: SITE_URL,
  });
  assert.equal(otherState.ok, true);
  assert.equal(otherState.identity.state, "TN");

  // A partial Organization earlier in the document must not shadow the
  // COMPLETE node after it.
  const completeLater = firstPartyIdentity({
    html: "",
    ldNodes: [
      { "@type": "Organization", name: "Flat Plumbing Co" },
      { "@type": "Dentist", name: "Louisville Dental Studio", telephone: "(502) 555-0111", address: { addressLocality: "Louisville", addressRegion: "KY" } },
    ],
    url: SITE_URL,
  });
  assert.equal(completeLater.ok, true);
  assert.equal(completeLater.identity.name, "Louisville Dental Studio");
  assert.equal(completeLater.identity.locality, "Louisville");
  assert.equal(completeLater.identity.phoneSurface, "schema_org_telephone");

  // Vertical local-business subtypes are accepted identity carriers…
  for (const type of [
    "Dentist", "HairSalon", "RealEstateAgent", "AutoRepair", "TattooParlor", "MassageBusiness",
    "LegalService", "BarberShop", "MedicalBusiness", "HealthAndBeautyBusiness", "PestControlService",
  ]) {
    const sub = firstPartyIdentity({
      html: "",
      ldNodes: [{ "@type": type, name: "Sub Type Co", address: { addressLocality: "Louisville", addressRegion: "KY" } }],
      url: SITE_URL,
    });
    assert.equal(sub.ok, true, `${type} must be an accepted identity carrier`);
  }
  // …bare Service/Person/WebSite/Article are not, and neither is anything that
  // merely CONTAINS a supported name: exact normalized types only.
  for (const type of ["Service", "Person", "WebSite", "Article", "Disorganization", "StorefrontPage", "MyPlumberArticle"]) {
    const rejected = firstPartyIdentity({
      html: "",
      ldNodes: [{ "@type": type, name: "Not A Business", address: { addressLocality: "Louisville", addressRegion: "KY" } }],
      url: SITE_URL,
    });
    assert.equal(rejected.ok, false, `${type} must not carry identity`);
  }

  // A schema.org URL tail is the same declaration as the plain name.
  const urlTyped = firstPartyIdentity({
    html: "",
    ldNodes: [{ "@type": "https://schema.org/Dentist", name: "Tail Typed Dental", address: { addressLocality: "Louisville", addressRegion: "KY" } }],
    url: SITE_URL,
  });
  assert.equal(urlTyped.ok, true, "a schema.org URL-typed node must be accepted");
  assert.equal(urlTyped.identity.name, "Tail Typed Dental");
});

test("a redirect landing on another owner quarantines that candidate — foreign JSON-LD never wears the original URL", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const victim = "https://victim.example/";
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      counts.firecrawl++;
      return new Response(JSON.stringify({ data: [{ url: victim, title: "Victim Plumbing" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("places.googleapis.com")) throw new Error("ZERO-PLACES CONTRACT VIOLATED");
    if (href === victim) {
      counts.pages++;
      // The follow-redirect fetch landed on an unrelated owner whose page
      // publishes ITS OWN complete JSON-LD identity.
      const resp = new Response(FIRST_PARTY_HTML.replaceAll("Flat Plumbing Co", "Unrelated Plumbing"), {
        status: 200, headers: { "content-type": "text/html" },
      });
      Object.defineProperty(resp, "url", { value: "https://unrelated.example/landing" });
      return resp;
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady({
    queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
    candidatesPerQuery: 4,
    env: { FIRECRAWL_API_KEY: "firecrawl", GHOST_AGENCY_SOCIAL_SEARCH: "false", GHOST_AGENCY_PHOTO_BANK: "false" },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
  }));
  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0, "a foreign landing page must never build under the victim's URL");
  assert.equal(out.held_rows.length, 1);
  assert.equal(out.held_rows[0].record.blocked_reason, "identity_cross_owner_redirect");
  const reject = out.rejects.find((r) => r.reason === "identity_cross_owner_redirect");
  assert.match(reject.detail, /victim\.example landed on unrelated\.example/);
  assertFunnelReconciles(out.funnel);
});

test("placesVerify without the manual_exact trigger stays at zero Places for every non-operator lane", async () => {
  for (const trigger of [undefined, "full_run", "scheduled_cron", "manual_console"]) {
    const counts = { firecrawl: 0, places: 0, pages: 0 };
    const input = baseInput({
      counts,
      extra: { placesVerify: true, candidatesPerQuery: 1, ...(trigger ? { trigger } : {}) },
    });
    const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
    assert.equal(out.ok, true, `${trigger}: ${JSON.stringify(out.rejects || []).slice(0, 300)}`);
    assert.equal(counts.places, 0, `trigger ${trigger || "(unspecified)"} must never dial Google`);
    assert.equal(out.provider_health.mode, "skipped_zero_google", "a zero-Places run reports skipped, never stale breaker state");
    assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_zero_google",
      "the stage 6 cost label must say what actually ran");
  }
});

test("operator_line uses Firecrawl-first discovery, first-party identity, and zero Places or photo media", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const fieldMasks = [];
  const requestUrls = [];
  const input = baseInput({
    counts,
    fieldMasks,
    env: {
      GOOGLE_PLACES_API_KEY: "places",
      GHOST_AGENCY_MINER_BRANDING_FALLBACK: "0",
    },
    extra: { trigger: "operator_line", candidatesPerQuery: 1 },
  });
  const routedFetch = input.fetchImpl;
  input.fetchImpl = async (url, init) => {
    requestUrls.push(String(url && url.url ? url.url : url));
    return routedFetch(url, init);
  };

  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  assert.equal(counts.firecrawl, 1, "one Firecrawl Search request discovers the first-party website");
  assert.equal(out.cost.firecrawl_search_calls, 1);
  assert.equal(counts.places, 0, "an exported Places key must not enable operator-line Google calls");
  assert.equal(out.cost.places_calls, 0);
  assert.equal(out.cost.places_photo_media_calls, 0);
  assertFirstPartyRecord(out.records[0]);
  assert.equal(out.records[0].discovery.via, "firecrawl_search");
  assert.equal(stageByName(out.funnel, "1_discovery_firecrawl").cost, "firecrawl_search");
  assert.equal(stageByName(out.funnel, "6_first_party_identity").cost, "first_party_zero_google");
  assert.equal(out.provider_health.mode, "skipped_zero_google");

  assert.equal(fieldMasks.length, 0, "operator-line must not build a Places field mask");
  assert.equal(requestUrls.some((url) => /places\.googleapis\.com\/.*\/media(?:\?|$)/i.test(url)), false,
    "the operator lane must never resolve Places photo media");
  assert.equal(requestUrls.some((url) => /api\.firecrawl\.dev\/v1\/search(?:\?|$)/i.test(url)), true,
    "the operator lane must use the website-search endpoint");
  assert.equal(requestUrls.some((url) => /places\.googleapis\.com/i.test(url)), false,
    "operator-line must not call Places even when the key is present");
  assertFunnelReconciles(out.funnel);
});

test("manual_exact Places opt-in requires the literal numeric single-candidate bound", async () => {
  for (const candidatesPerQuery of ["1", 0]) {
    const counts = { firecrawl: 0, places: 0, pages: 0 };
    const input = baseInput({
      counts,
      extra: { placesVerify: true, trigger: "manual_exact", candidatesPerQuery },
    });
    const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
    assert.equal(out.ok, true, `${JSON.stringify(candidatesPerQuery)}: ${JSON.stringify(out.rejects || []).slice(0, 300)}`);
    assert.equal(counts.places, 0, "coercible or clamped input must not silently authorize Google spend");
    assert.equal(out.provider_health.mode, "skipped_zero_google");
    assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_zero_google");
  }
});

test("a first-party sport-fencing hold cites no google_business_profile evidence", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const sportHtml = FIRST_PARTY_HTML
    .replaceAll("Flat Plumbing Co", "Louisville Fencing Academy")
    .replace("<h3>Drain Cleaning</h3><h3>Water Heater Repair</h3>", "<h3>Épée Classes</h3>")
    .replace("Plumbing repairs and water heaters in Louisville.", "Olympic fencing club — sabre and épée coaching, tournaments and classes for kids.");
  const input = baseInput({
    counts,
    pages: { [SITE_URL]: sportHtml },
    firecrawlResults: [{ url: SITE_URL, title: "Louisville Fencing Academy" }],
    env: { GHOST_AGENCY_SPORT_FENCING_GUARD: "1" },
    extra: { queries: [{ industry: "fencing", location: "Louisville KY", textQuery: "fencing in Louisville KY", queryGroup: 0 }] },
  });
  const out = await withGlobalFetch(input.fetchImpl, () => mineBuildReady(input));
  assert.equal(out.ok, true);
  assert.equal(counts.places, 0);
  const hold = out.held_rows.find((row) => row.record.blocked_reason === "vertical_mismatch_sport_fencing");
  assert.ok(hold, JSON.stringify(out.rejects || []).slice(0, 400));
  assert.deepEqual(hold.record.vertical_hold.evidence_sources, ["business_name", "first_party_site"],
    "a hold with no Google observation must not cite google_business_profile");
});

test("a foreign redirect quarantines even on the opted-in manual_exact lane — Google is never asked to launder it", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const victim = "https://victim.example/";
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      counts.firecrawl++;
      return new Response(JSON.stringify({ data: [{ url: victim, title: "Victim Plumbing | Louisville KY" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("places.googleapis.com")) {
      // This stub WOULD verify the victim domain — the check must run first.
      counts.places++;
      return new Response(JSON.stringify({ places: [{
        id: "place-victim",
        displayName: { text: "Victim Plumbing" },
        websiteUri: victim,
        addressComponents: [
          { types: ["locality"], longText: "Louisville", shortText: "Louisville" },
          { types: ["administrative_area_level_1"], longText: "Kentucky", shortText: "KY" },
        ],
      }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href === victim) {
      counts.pages++;
      const resp = new Response(FIRST_PARTY_HTML.replaceAll("Flat Plumbing Co", "Unrelated Plumbing"), {
        status: 200, headers: { "content-type": "text/html" },
      });
      Object.defineProperty(resp, "url", { value: "https://unrelated.example/landing" });
      return resp;
    }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  // BREAKER NO-TOUCH PROOF: seed one consecutive failure on the module-level
  // Google breaker. beginRun() would zero it, so the tally surviving the run
  // proves the quarantined opted-in candidate never touched breaker state.
  const { searchPlacesPage, discoveryStatus } = require("../lib/lead-miner");
  await searchPlacesPage({
    key: "seed", textQuery: "seed", pageSize: 1,
    fetchImpl: async () => ({ status: 503, headers: new Map(), json: async () => ({}), text: async () => "" }),
  });
  assert.equal(discoveryStatus().failures, 1, "the fixture must have seeded exactly one breaker failure");
  let out;
  try {
    out = await withGlobalFetch(fetchImpl, () => mineBuildReady({
      queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
      candidatesPerQuery: 1,
      placesVerify: true,
      trigger: "manual_exact",
      env: { GOOGLE_PLACES_API_KEY: "places", FIRECRAWL_API_KEY: "firecrawl", GHOST_AGENCY_SOCIAL_SEARCH: "false", GHOST_AGENCY_PHOTO_BANK: "false" },
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
    }));
    assert.equal(discoveryStatus().failures, 1,
      "beginRun() must not have been called: a quarantined opted-in candidate never touches the Google breaker");
  } finally {
    // Restore the module-level breaker for every later suite in the process.
    await searchPlacesPage({
      key: "seed", textQuery: "seed", pageSize: 1,
      fetchImpl: async () => ({ status: 200, headers: new Map(), json: async () => ({ places: [] }), text: async () => "" }),
    });
  }
  assert.equal(out.ok, true);
  assert.equal(out.records.length, 0, "a Google match on the original domain must not launder foreign bytes");
  assert.equal(counts.places, 0, "the cross-owner check runs BEFORE the lookup, so the call is never spent");
  assert.equal(out.held_rows.length, 1);
  assert.equal(out.held_rows[0].record.blocked_reason, "identity_cross_owner_redirect");
  // GOOGLE REPORTING IS LAZY: no lookup ran, so the run reports as the
  // zero-Places run it actually was — even though it was opted in.
  assert.equal(stageByName(out.funnel, "6_nap_verification").cost, "first_party_zero_google");
  assert.deepEqual(out.provider_health, { mode: "skipped_zero_google" });
  assertFunnelReconciles(out.funnel);
});

test("an owned-subdomain landing is the same registrable owner and passes", async () => {
  // Both directions must pass: apex -> owned child and owned child -> apex.
  // Foreign owners remain covered by the quarantine regressions above; the
  // strict directional rule still refuses unrelated sibling hosts.
  const routes = [
    { candidate: SITE_URL, landing: "https://www.flatplumbing.example/" },
    { candidate: SITE_URL, landing: "https://locations.flatplumbing.example/louisville" },
    { candidate: "https://locations.flatplumbing.example/", landing: SITE_URL },
  ];
  for (const { candidate, landing } of routes) {
    const counts = { firecrawl: 0, places: 0, pages: 0 };
    const fetchImpl = async (url) => {
      const href = String(url && url.url ? url.url : url);
      if (href.includes("firecrawl")) {
        counts.firecrawl++;
        return new Response(JSON.stringify({ data: [{ url: candidate, title: "Flat Plumbing Co | Louisville KY" }] }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (href.includes("places.googleapis.com")) {
        counts.places++;
        throw new Error("ZERO-PLACES CONTRACT VIOLATED");
      }
      if (href === candidate) {
        counts.pages++;
        const resp = new Response(FIRST_PARTY_HTML, { status: 200, headers: { "content-type": "text/html" } });
        Object.defineProperty(resp, "url", { value: landing });
        return resp;
      }
      throw new Error(`unstubbed fetch: ${href}`);
    };
    const out = await withGlobalFetch(fetchImpl, () => mineBuildReady({
      queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
      candidatesPerQuery: 4,
      env: { FIRECRAWL_API_KEY: "firecrawl", GHOST_AGENCY_SOCIAL_SEARCH: "false", GHOST_AGENCY_PHOTO_BANK: "false" },
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
    }));
    const route = `${candidate} -> ${landing}`;
    assert.equal(out.ok, true, `${route}: ${JSON.stringify(out.rejects || []).slice(0, 400)}`);
    assert.equal(out.records.length, 1,
      `${route} is the same owner and must build: ${JSON.stringify(out.rejects || []).slice(0, 600)}`);
    assert.equal(out.held_rows.length, 0, `${route} must not quarantine`);
    assert.equal(counts.places, 0, `${route} must remain zero-Places`);
    assert.equal(out.records[0].identity_source, "first_party");
  }
});

test("two Facebook pages mint two distinct identity-hold IDs", async () => {
  const counts = { firecrawl: 0, places: 0, pages: 0 };
  const pageA = "https://www.facebook.com/flatplumbingky";
  const pageB = "https://www.facebook.com/otherplumberlou";
  // Facebook pages with no structured JSON-LD identity: both quarantine.
  const fbHtml = (name) => `<!doctype html><html><head><title>${name} | Louisville KY</title></head><body>
    <h1>${name}</h1><p>Plumbing repairs and water heaters.</p>
    <a href="mailto:${name.toLowerCase().replace(/[^a-z]/g, "")}@gmail.com">Email us</a></body></html>`;
  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      counts.firecrawl++;
      return new Response(JSON.stringify({ data: [
        { url: pageA, title: "Flat Plumbing | Louisville KY" },
        { url: pageB, title: "Other Plumber | Louisville KY" },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("places.googleapis.com")) throw new Error("ZERO-PLACES CONTRACT VIOLATED");
    if (href === pageA || href === `${pageA}/`) { counts.pages++; return new Response(fbHtml("Flat Plumbing"), { status: 200, headers: { "content-type": "text/html" } }); }
    if (href === pageB || href === `${pageB}/`) { counts.pages++; return new Response(fbHtml("Other Plumber"), { status: 200, headers: { "content-type": "text/html" } }); }
    throw new Error(`unstubbed fetch: ${href}`);
  };
  const out = await withGlobalFetch(fetchImpl, () => mineBuildReady({
    queries: [{ industry: "plumbing", location: "Louisville KY", textQuery: "plumbing in Louisville KY", queryGroup: 0 }],
    candidatesPerQuery: 4,
    env: {
      FIRECRAWL_API_KEY: "firecrawl",
      GHOST_AGENCY_SOCIAL_SEARCH: "false",
      GHOST_AGENCY_PHOTO_BANK: "false",
      // Strict-mode pin (the suite default, baseInput, does not reach this
      // hand-built input): schema-less Facebook pages quarantine.
      GHOST_AGENCY_IDENTITY_TRUST: "0",
    },
    fetchImpl,
    resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
  }));
  assert.equal(out.ok, true);
  assert.equal(out.held_rows.length, 2, JSON.stringify(out.rejects || []).slice(0, 400));
  const [a, b] = out.held_rows.map((row) => row.prospect_id);
  assert.notEqual(a, b, "two Facebook pages must never collapse into one shared hold id");
  assert.match(a, /flatplumbingky/);
  assert.match(b, /otherplumberlou/);
});

test("identity holds emit identity_hold_* persistence labels, never vertical_hold_*", async () => {
  const holdRow = () => ({
    prospect_id: "fp-hold-example",
    status: "held",
    business_name: "Example Co",
    industry: "plumbing",
    city: null,
    state: null,
    record: {
      prospect_id: "fp-hold-example",
      business_name: "Example Co",
      industry: "plumbing",
      status: "held",
      blocked_reason: "identity_unverified_first_party",
      identity_hold: { reason: "identity_unverified_first_party", missing: ["locality", "state"] },
    },
  });
  const base = {
    persist: true,
    actor: "test",
    trigger: "test",
    selectCount: 1,
    selectRowsImpl: async () => ({ mode: "live_select", rows: [] }),
  };
  const conflict = await persistMinedRows({
    ...base,
    rows: [holdRow()],
    selectImpl: async () => ({ mode: "live_select", data: [] }),
    insertRowImpl: async () => ({ mode: "error", error: { category: "write_conflict" } }),
  });
  assert.equal(conflict.rows[0].persistence, "identity_hold_insert_conflict");
  const failed = await persistMinedRows({
    ...base,
    rows: [holdRow()],
    selectImpl: async () => ({ mode: "live_select", data: [] }),
    insertRowImpl: async () => null,
  });
  assert.equal(failed.rows[0].persistence, "identity_hold_write_failed");
  const recheck = await persistMinedRows({
    ...base,
    rows: [holdRow()],
    selectImpl: async () => { throw new Error("index unavailable"); },
    insertRowImpl: async () => { throw new Error("must not insert without the exact recheck"); },
  });
  assert.equal(recheck.rows[0].persistence, "identity_hold_identity_recheck_failed");
  for (const result of [conflict, failed, recheck]) {
    assert.doesNotMatch(result.rows[0].persistence, /^vertical_hold_/);
  }
});
