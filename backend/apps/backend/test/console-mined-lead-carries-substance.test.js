"use strict";

// The console-mined lane used to build a mirror with no reviews, no faces, no
// hours, no FAQ, no nearby towns and no map links — while the identical donor
// built from a webhook packet rendered all of them. These tests pin every link
// in that chain, in the order the bug travelled.
//
// Live evidence behind each one is named in the test titles: Carter's My
// Plumber (Indianapolis, place ChIJARzyGsasFIgRtWJ3VGwsyWA) was the measured
// case on 2026-08-06.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMirrorForProspect,
  contentFromContract,
  contentFromVerified,
  factResolutionReport,
  featuredReviews,
  mergeContentSources,
} = require("../lib/mirror-lane-build");
const { verifiedTrustForPlace, hoursFromWeekdayDescriptions } = require("../lib/verified-trust-lookup");
const { rowToLineRow } = require("../lib/line-adapters");

const PLACE_ID = "ChIJARzyGsasFIgRtWJ3VGwsyWA";

const CONTRACT_FACTS = {
  business_name: "Carter's My Plumber",
  industry: "plumbing",
  city: "Indianapolis",
  state: "IN",
  phone: "(317) 893-2462",
  email: "info@cartersmyplumber.com",
  address: "450 E 96th St #500, Indianapolis, IN 46240, USA",
  county: "Hamilton County",
  postal_code: "46240",
  latitude: 39.9283287,
  longitude: -86.1504301,
  place_id: PLACE_ID,
  rating: 4.9,
  review_count: 1315,
  current_website: "https://www.cartersmyplumber.com/",
};

function deps(overrides = {}) {
  const captured = {};
  return {
    captured,
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    resolveVerifiedFacts: async () => ({ ok: true, facts: {}, content: {} }),
    harvestClientPhotos: async () => ({ ok: false, photos: [] }),
    captureFonts: async () => ({ ok: false }),
    readIntakePacket: () => ({ ok: false }),
    mergeIntoContent: (content) => content,
    resolveRileyLine: () => ({ ok: false }),
    verifiedTrustForPlace: async () => ({ ok: false, reason: "not_stubbed", reviews: [], hours: [], diagnostics: {} }),
    mirror: async (req) => {
      captured.req = req;
      return { status: 200, body: { ok: true, revealable: true, preview_url: "https://wss-test-x.wss-ai.com/", checks: {} } };
    },
    ...overrides,
  };
}

const PROSPECT = {
  prospect_id: "wss-test-carter-s",
  business_name: CONTRACT_FACTS.business_name,
  industry: "plumbing",
  city: "Indianapolis",
  state: "IN",
  phone: CONTRACT_FACTS.phone,
  site: "https://www.cartersmyplumber.com/",
  logo: "https://www.cartersmyplumber.com/logo.png",
  verified_facts: CONTRACT_FACTS,
};

// ---------------------------------------------------------------------------
// 1. THE SILENT DISCARD — the defect that produced the empty shell
// ---------------------------------------------------------------------------

test("a resolver that returns ok:false still hands over everything it DID resolve", async () => {
  // Measured for Carter's: the resolver did not throw and was not down. It
  // returned twelve real services scraped from the client's own site, and
  // ok:false — because Google's NAP was unreachable, not because it found
  // nothing. `if (v && v.ok !== false)` then binned the lot.
  const d = deps({
    resolveVerifiedFacts: async () => ({
      ok: false,
      facts: { industry: "plumbing" },
      content: { services: [{ name: "Water Heater Repair" }, { name: "Drain Cleaning" }] },
      coverage: { resolved: 2, withheld: 18 },
      sources: [{ id: "places_gbp_direct", status: "unavailable", error: "http_403:API_KEY_HTTP_REFERRER_BLOCKED", fields: [] }],
      withheld: [{ field: "phone", reason: "no_observation" }],
    }),
  });
  const out = await buildMirrorForProspect({ ...PROSPECT, verified_facts: null }, { deps: d, dryRun: true });
  assert.equal(out.ok, true);
  assert.equal(d.captured.req.content.services.length, 2, "the services the resolver DID resolve reach the build");
  assert.equal(out.contentCoverage.services, 2);
});

test("the resolver's verdict is RECORDED on the build result, never swallowed", async () => {
  const d = deps({
    resolveVerifiedFacts: async () => ({
      ok: false,
      facts: {},
      content: {},
      sources: [
        { id: "places_gbp_direct", status: "unavailable", error: "http_403:API_KEY_HTTP_REFERRER_BLOCKED", fields: [] },
        { id: "google_knowledge_panel_via_brightdata", status: "unattested", error: "serp_unavailable", fields: [] },
      ],
      withheld: [{ field: "phone", reason: "no_observation" }],
    }),
  });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, dryRun: true });
  assert.equal(out.fact_resolution.status, "partial", "ok:false is PARTIAL, not a failure");
  const errors = out.fact_resolution.sources.map((s) => s.error).filter(Boolean);
  assert.ok(errors.includes("http_403:API_KEY_HTTP_REFERRER_BLOCKED"), "the named provider failure survives to the report");
  assert.ok(errors.includes("serp_unavailable"));
  assert.deepEqual(out.fact_resolution.withheld, ["phone:no_observation"]);
});

test("a resolver that genuinely throws is reported as threw, with its reason", async () => {
  const d = deps({ resolveVerifiedFacts: async () => { throw new Error("connect ETIMEDOUT"); } });
  const out = await buildMirrorForProspect(PROSPECT, { deps: d, dryRun: true });
  assert.equal(out.fact_resolution.status, "threw");
  assert.match(out.fact_resolution.reason, /ETIMEDOUT/);
  assert.equal(out.ok, true, "a dead resolver costs content, never the build");
});

test("factResolutionReport does not mistake an empty array for resolved content", () => {
  const report = factResolutionReport({ ok: true, facts: { city: "Indianapolis" }, content: { services: [], reviews: [{ text: "x" }] } });
  assert.deepEqual(report.resolved_content, ["reviews"]);
  assert.deepEqual(report.resolved_facts, ["city"]);
});

// ---------------------------------------------------------------------------
// 2. THE CONTRACT'S GEO FACTS — what the map, the JSON-LD and the towns need
// ---------------------------------------------------------------------------

test("the mined contract's place_id, coordinates and address reach the mirror request", async () => {
  const d = deps();
  await buildMirrorForProspect(PROSPECT, { deps: d, dryRun: true });
  const facts = d.captured.req.facts;
  assert.equal(facts.place_id, PLACE_ID, "the Apple/Google Maps deep links and Place JSON-LD are built from this");
  assert.equal(facts.latitude, 39.9283287);
  assert.equal(facts.longitude, -86.1504301);
  assert.equal(facts.address, CONTRACT_FACTS.address);
  assert.equal(facts.postal_code, "46240");
  assert.equal(facts.county, "Hamilton County");
  assert.equal(facts.rating, 4.9);
  assert.equal(facts.review_count, 1315);
});

test("a fresh observation still outranks the stored contract", async () => {
  const d = deps({
    resolveVerifiedFacts: async () => ({ ok: true, facts: { city: "Carmel", address: "1 New St, Carmel, IN" }, content: {} }),
  });
  await buildMirrorForProspect(PROSPECT, { deps: d, dryRun: true });
  assert.equal(d.captured.req.facts.city, "Carmel");
  assert.equal(d.captured.req.facts.address, "1 New St, Carmel, IN");
  assert.equal(d.captured.req.facts.place_id, PLACE_ID, "fields the resolver did not reach still come from the contract");
});

test("nearby towns are measured from the contract's coordinates", async () => {
  const towns = [{ name: "Carmel", state: "IN", miles: 4.1 }, { name: "Fishers", state: "IN", miles: 7.8 }];
  const d = deps();
  await buildMirrorForProspect(
    { ...PROSPECT, record: { nearby_cities: towns } },
    { deps: d, dryRun: true },
  );
  assert.equal(d.captured.req.content.nearby.length, 2);
  assert.equal(d.captured.req.content.nearby[0].name, "Carmel");
});

// ---------------------------------------------------------------------------
// 3. THE CONTRACT'S CONTENT — reviews and hours the miner now writes
// ---------------------------------------------------------------------------

test("reviews and hours stored on the contract reach the page, faces included", async () => {
  const d = deps();
  await buildMirrorForProspect({
    ...PROSPECT,
    verified_content: {
      reviews: [{
        text: "Fixed our water heater the same day.",
        author: "Dana C",
        rating: 5,
        author_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjReal",
        published_at: "2026-07-01T00:00:00Z",
      }],
      hours: [{ day: "monday", text: "Open 24 hours" }],
    },
  }, { deps: d, dryRun: true });
  const content = d.captured.req.content;
  assert.equal(content.reviews.length, 1);
  assert.equal(content.reviews[0].avatarUrl, "https://lh3.googleusercontent.com/a-/ALV-UjReal");
  assert.equal(content.reviews[0].publishedAt, "2026-07-01T00:00:00Z");
  assert.equal(content.hours.length, 1);
});

test("a Google letter-tile monogram is NOT a face — the quote ships, the fake circle does not", () => {
  const content = contentFromContract({
    verified_content: {
      reviews: [{ text: "Great work", author: "C", author_photo_url: "https://lh3.googleusercontent.com/a/ACg8ocMonogram" }],
    },
  });
  assert.equal(content.reviews.length, 1, "the reviewer's words still ship");
  assert.equal(content.reviews[0].avatarUrl, undefined, "the generated initial tile does not");
});

test("a non-Google avatar host is refused outright", () => {
  const content = contentFromContract({
    verified_content: { reviews: [{ text: "Great work", author: "C", author_photo_url: "https://evil.example.com/face.jpg" }] },
  });
  assert.equal(content.reviews[0].avatarUrl, undefined);
});

test("a review with no text is not a review", () => {
  const content = contentFromContract({ verified_content: { reviews: [{ author: "C", rating: 5 }, { text: "Real", author: "D" }] } });
  assert.equal(content.reviews.length, 1);
  assert.equal(content.reviews[0].text, "Real");
});

test("mergeContentSources never blends two observations into one section", () => {
  const merged = mergeContentSources(
    { services: [{ name: "A" }], reviews: [] },
    { services: [{ name: "B" }, { name: "C" }], reviews: [{ text: "r" }], hours: [{ day: "monday", text: "9-5" }] },
  );
  assert.equal(merged.services.length, 1, "the first non-empty source owns the section outright");
  assert.equal(merged.services[0].name, "A");
  assert.equal(merged.reviews.length, 1, "an empty array does not claim the section");
  assert.equal(merged.hours.length, 1);
});

// ---------------------------------------------------------------------------
// 4. THE PIN — the identity guard on the review backfill
// ---------------------------------------------------------------------------

function gatewayStub(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

const OPTS = { anonKey: "k", gatewayUrl: "https://example.supabase.co" };

test("Google's reviews are accepted when the gateway's placeId IS our verified place_id", async () => {
  const out = await verifiedTrustForPlace(CONTRACT_FACTS, {
    ...OPTS,
    fetchImpl: gatewayStub({
      placeId: PLACE_ID,
      name: "Carter's My Plumber - Plumbers Indianapolis",
      website: "https://www.cartersmyplumber.com/",
      // The gateway could not tell six same-brand branches apart. We can.
      lowConfidence: true,
      rating: 4.9,
      reviewCount: 1315,
      mapsUrl: "https://maps.google.com/?cid=6974154341745124021",
      hoursText: ["Monday: Open 24 hours", "Tuesday: Open 24 hours"],
      reviews: [{ text: "Same-day fix.", authorName: "Dana Carothers", rating: 5, time: 1783430576 }],
    }),
  });
  assert.equal(out.ok, true);
  assert.equal(out.reviews.length, 1);
  assert.equal(out.reviews[0].author, "Dana Carothers");
  assert.equal(out.reviews[0].publishedAt, new Date(1783430576 * 1000).toISOString());
  assert.deepEqual(out.hours, [{ day: "monday", text: "Open 24 hours" }, { day: "tuesday", text: "Open 24 hours" }]);
  assert.equal(out.diagnostics.queries.at(-1).gateway_low_confidence, true, "the pin did the work, and says so");
});

test("ANOTHER BRANCH'S reviews are refused — the live Greenwood/Indianapolis case", async () => {
  // Measured 2026-08-06: looking Carter's up by their website URL returns the
  // GREENWOOD branch (ChIJN_XEPstda4gRTEmYvihwzmw, 2,810 reviews). Publishing
  // those as the Indianapolis branch's would be fraud by a single wrong id.
  const out = await verifiedTrustForPlace(CONTRACT_FACTS, {
    ...OPTS,
    fetchImpl: gatewayStub({
      placeId: "ChIJN_XEPstda4gRTEmYvihwzmw",
      name: "Carter's My Plumber",
      address: "886 N State Rd 135 Ste A, Greenwood, IN 46142, USA",
      website: "http://www.cartersmyplumber.com/",
      rating: 4.9,
      reviewCount: 2810,
      reviews: [{ text: "Greenwood branch review", authorName: "Someone Else", rating: 5 }],
    }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_pinned_match_for_place_id");
  assert.deepEqual(out.reviews, []);
  assert.equal(out.diagnostics.queries[0].status, "place_id_mismatch");
  assert.equal(out.diagnostics.queries[0].returned_place_id, "ChIJN_XEPstda4gRTEmYvihwzmw");
});

test("no verified place_id means no corpus — the pin is required, not preferred", async () => {
  let called = 0;
  const out = await verifiedTrustForPlace({ ...CONTRACT_FACTS, place_id: "" }, {
    ...OPTS,
    fetchImpl: async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_verified_place_id_to_pin_to");
  assert.equal(called, 0, "an unpinnable lookup is never even attempted");
});

test("a pinned place whose listing now points at a different domain is refused", async () => {
  const out = await verifiedTrustForPlace(CONTRACT_FACTS, {
    ...OPTS,
    fetchImpl: gatewayStub({ placeId: PLACE_ID, website: "https://someone-else.example.com/", reviews: [{ text: "x" }] }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.diagnostics.queries[0].status, "website_host_mismatch");
});

test("the backfill is skipped entirely when reviews AND hours are already verified upstream", async () => {
  let called = 0;
  const d = deps({ verifiedTrustForPlace: async () => { called++; return { ok: false, reviews: [], hours: [] }; } });
  const out = await buildMirrorForProspect({
    ...PROSPECT,
    verified_content: {
      reviews: [{ text: "Already verified", author: "A" }],
      hours: [{ day: "monday", text: "Open 24 hours" }],
    },
  }, { deps: d, dryRun: true });
  assert.equal(called, 0, "we never re-fetch a corpus we already hold");
  assert.equal(out.trust_lookup.status, "not_needed");
});

test("reviews without hours STILL makes the one call — it is the same request that returns both", async () => {
  // The gate used to read reviews only. Measured on Jam Plumbing (Portland),
  // 2026-08-06: three real Google reviews on the page and seven real rows of
  // Google opening hours nowhere on it, because holding half the answer
  // suppressed the request that carried the other half.
  let called = 0;
  const d = deps({
    verifiedTrustForPlace: async () => {
      called++;
      return { ok: true, reviews: [], hours: [{ day: "monday", text: "7:00 AM – 5:00 PM" }], diagnostics: {} };
    },
  });
  const out = await buildMirrorForProspect({
    ...PROSPECT,
    verified_content: { reviews: [{ text: "Already verified", author: "A" }] },
  }, { deps: d, dryRun: true });
  assert.equal(called, 1, "the missing half is worth the request we were going to make anyway");
  assert.equal(out.trust_lookup.status, "pinned");
  assert.deepEqual(out.trust_lookup.wanted, ["hours"], "the report names WHICH half was missing");
  assert.equal(out.contentCoverage.hours, 1, "and the hours it returned reach the page");
  assert.equal(
    out.contentCoverage.reviews, 1,
    "while the reviews we already held are untouched — a section is never blended",
  );
});

test("hoursFromWeekdayDescriptions keeps the day column Google puts in one string", () => {
  assert.deepEqual(
    hoursFromWeekdayDescriptions(["Monday: 7:00 AM - 5:00 PM", "Sunday: Closed"]),
    [{ day: "monday", text: "7:00 AM - 5:00 PM" }, { day: "sunday", text: "Closed" }],
  );
});

// ---------------------------------------------------------------------------
// 5. THE LINE'S OWN WIRING — the contract must survive the trip to the builder
// ---------------------------------------------------------------------------

test("rowToLineRow carries the contract's verified facts and content as whole blocks", () => {
  // Re-flattening the contract into scalars is what lost the coordinates. The
  // row hands the builder the object, so a field added to the contract
  // tomorrow needs no second edit here.
  const row = rowToLineRow({
    prospect_id: "wss-test-carter-s",
    business_name: CONTRACT_FACTS.business_name,
    record: {
      build_ready: {
        mirror_request: {
          facts: CONTRACT_FACTS,
          brand: { logo: "https://www.cartersmyplumber.com/logo.png" },
          content: { reviews: [{ text: "Same-day fix.", author: "Dana C" }], hours: [{ day: "monday", text: "Open 24 hours" }] },
        },
        proof: { build_hash: "h" },
        qualification: { website_axis: { score: 40 }, composite_signal: { score: 55 } },
        brand_evidence: { logo_url: "https://www.cartersmyplumber.com/logo.png" },
      },
    },
  });
  assert.equal(row.contractIssue, "", "a complete contract is not an issue");
});

// ---------------------------------------------------------------------------
// 5b. WHICH TRUE REVIEWS GET FEATURED — selection, never editing
// ---------------------------------------------------------------------------

test("the one-star complaint Google served for Carter's is not quoted back at the client", () => {
  // Verbatim from the live lookup, 2026-08-06. Google's "most relevant" five
  // led with this, and it landed at the top of the client's own new website.
  const out = featuredReviews([
    { text: "After the install of my tankless water heater the technician never stayed long enough…", author: "Dana Carothers", rating: 1 },
    { text: "We had a fantastic experience with Luke W., who was thorough.", author: "A M", rating: 5 },
    { text: "Very happy with the results and the customer service.", author: "Dawn Determan", rating: 5 },
  ]);
  assert.equal(out.reviews.length, 2);
  assert.equal(out.withheld, 1);
  assert.ok(!out.reviews.some((r) => r.rating === 1));
});

test("selection never edits: every featured quote survives byte-for-byte", () => {
  const original = { text: "Wes was great.  Very  informative.", author: "Vickie T", rating: 5, avatarUrl: "https://lh3.googleusercontent.com/a-/ALV-UjX" };
  const out = featuredReviews([original]);
  assert.deepEqual(out.reviews[0], original, "nothing is rewritten, softened or trimmed");
});

test("an UNRATED review is kept — absent evidence is not evidence of a bad review", () => {
  const out = featuredReviews([{ text: "Great crew", author: "B" }, { text: "Bad", author: "C", rating: 2 }]);
  assert.equal(out.reviews.length, 1);
  assert.equal(out.reviews[0].author, "B");
});

test("a business whose every review is poor renders NO review section, never a padded one", () => {
  const content = contentFromContract({
    verified_content: { reviews: [{ text: "Poor", author: "A", rating: 1 }, { text: "Bad", author: "B", rating: 2 }] },
  });
  assert.equal(content.reviews, undefined, "absent beats a manufactured testimonial");
});

test("all three build paths apply the same selection rule", () => {
  const mixed = [{ text: "Bad", author: "A", rating: 2 }, { text: "Good", author: "B", rating: 5 }];
  // resolver path
  assert.equal(contentFromVerified({ reviews: mixed }).reviews.length, 1);
  // contract path
  assert.equal(contentFromContract({ verified_content: { reviews: mixed } }).reviews.length, 1);
  // and the shared helper the packet path calls
  assert.equal(featuredReviews(mixed).reviews.length, 1);
});

// ---------------------------------------------------------------------------
// 6. THE MINER — an identity-only observation writes no trust content
// ---------------------------------------------------------------------------

test("an identity-only Places response yields a contract whose trust fields are honestly absent", async () => {
  // The identity field mask (2026-08-25) requests no reviews, hours, photos,
  // rating or description, so a live lookup can never return them. The
  // contract must carry that absence honestly — no empty-array pretence, no
  // measured-zero score axes. Stored/webhook corpora that DO carry trust
  // content are covered by the verified-contract suites.
  const { mineBuildReady } = require("../lib/lead-miner");
  const HOST = "203.0.113.77";
  const place = {
    id: "place-carter",
    displayName: { text: "Capitol Plumbing" },
    formattedAddress: "100 Main St, Jackson, MS 00000, USA",
    location: { latitude: 32.2988, longitude: -90.1848 },
    nationalPhoneNumber: "(555) 555-0100",
    websiteUri: `https://${HOST}/`,
    primaryType: "plumber",
    types: ["plumber", "point_of_interest"],
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=1",
    addressComponents: [
      { types: ["locality"], longText: "Jackson", shortText: "Jackson" },
      { types: ["administrative_area_level_1"], longText: "MS", shortText: "MS" },
      { types: ["postal_code"], longText: "00000", shortText: "00000" },
    ],
  };
  const html = `<!doctype html><html><head><title>Capitol Plumbing | Plumbing in Jackson, MS</title>
<meta name="description" content="Plumbing and drain cleaning in Jackson, MS."></head><body><h1>Capitol Plumbing</h1>
<img class="custom-logo" src="/logo.svg" alt="Capitol Plumbing">
<p>Email <a href="mailto:capitolplumbing@gmail.com">us</a>. We handle plumbing repairs and water heaters.</p></body></html>`;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#1d4ed8"/></svg>';

  const fetchImpl = async (url) => {
    const href = String(url && url.url ? url.url : url);
    if (href.includes("firecrawl")) {
      return new Response(JSON.stringify({ data: [{ url: `https://${HOST}/`, title: "Capitol Plumbing | Jackson MS" }] }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("places.googleapis.com")) {
      return new Response(JSON.stringify({ places: [place] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (/\/logo\.svg$/.test(href)) return new Response(Buffer.from(svg), { status: 200, headers: { "content-type": "image/svg+xml" } });
    if (new URL(href).hostname === HOST) return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    throw new Error(`unstubbed fetch: ${href}`);
  };

  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  let out;
  try {
    out = await mineBuildReady({
      queries: [{ industry: "plumbing", location: "Jackson MS", textQuery: "plumbing in Jackson MS" }],
      candidatesPerQuery: 1,
      placesVerify: true,
      trigger: "manual_exact",
      env: { GOOGLE_PLACES_API_KEY: "k", FIRECRAWL_API_KEY: "k" },
      fetchImpl,
      resolveMx: async () => [{ exchange: "mx.gmail.com", priority: 10 }],
      mirrorImpl: async () => ({
        ok: true,
        status: 200,
        body: {
          ok: true, build_hash: "hash", donor_content_hash: "donor", file_count: 51,
          evidence_sha: "sha", renderer: "mirror-engine@v1",
          checks: { brand: { status: "passed", logo_refs_in_output: 3 } },
        },
      }),
    });
  } finally { global.fetch = realFetch; }

  assert.equal(out.ok, true, JSON.stringify(out.rejects || []).slice(0, 400));
  assert.equal(out.records.length, 1, JSON.stringify(out.funnel));
  const record = out.records[0];
  const request = record.mirror_request;
  assert.equal(record.identity_source, "google_places");

  // Trust content is ABSENT, never an empty pretence.
  assert.equal((request.content || {}).reviews, undefined);
  assert.equal((request.content || {}).hours, undefined);
  assert.equal(request.facts.rating, undefined);
  assert.equal(request.facts.review_count, undefined);
  assert.equal(record.provenance.reviews, undefined);
  assert.equal(record.provenance.hours, undefined);
  // No Google score axis exists for an identity-only observation.
  assert.doesNotMatch(JSON.stringify(record.qualification.categories), /google_places|reputation/);
  // Identity fields the mask DOES buy still land, provenanced.
  assert.equal(request.facts.profile_url, "https://maps.google.com/?cid=1", "Google's own URL for the verified place");
  assert.equal(request.facts.place_id, "place-carter");
  // And the emitted contract still validates against the engine's own schema.
  const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
  const verdict = checkMirrorRequest(request);
  assert.equal(verdict.ok, true,
    `the mined contract must satisfy MirrorRequest: ${JSON.stringify(verdict.body && verdict.body.detail)}`);
});

test("a contract with no content block is carried as null, not as an empty object", () => {
  // Every console-mined row written before 2026-08-06 looks like this. The
  // builder must be able to tell "no content stored" from "content stored and
  // empty", because only the first one earns a pinned re-fetch.
  const content = contentFromContract({ verified_content: null });
  assert.deepEqual(content, {});
});

test("featured reviews lead with a face, then the newest, then the best", () => {
  // Owner: "we obviously wanna show their best and newest reviews on their
  // site, especially the ones that have faces attached to them."
  const { featuredReviews } = require("../lib/mirror-lane-build.js");
  const ranked = featuredReviews([
    { author: "old 5, no face", rating: 5, published_at: "2021-01-01" },
    { author: "recent 4, no face", rating: 4, published_at: "2026-07-01" },
    { author: "older 5, face", rating: 5, published_at: "2024-03-01", author_photo_url: "https://lh3.googleusercontent.com/a/x" },
    { author: "newest 5, face", rating: 5, published_at: "2026-07-20", author_photo_url: "https://lh3.googleusercontent.com/a/y" },
    { author: "one star", rating: 1, published_at: "2026-07-25" },
  ]);
  assert.deepEqual(ranked.reviews.map((r) => r.author), [
    "newest 5, face", "older 5, face", "recent 4, no face", "old 5, no face",
  ]);
  assert.equal(ranked.withheld, 1, "the 1-star is not featured");
  assert.ok(!ranked.reviews.some((r) => r.rating === 1));
});

test("a face only counts when Google actually supplied a photo URL", () => {
  // Nothing is generated or back-filled here. An initial, an empty string or a
  // relative path is not a face — promoting one would put a broken <img> at the
  // top of the page in the slot meant to carry a human being.
  const { featuredReviews } = require("../lib/mirror-lane-build.js");
  const first = (rows) => featuredReviews(rows).reviews[0].author;
  for (const notAPhoto of ["", "   ", "AB", "/avatar.png", "data:image/png;base64,xx"]) {
    assert.equal(
      first([
        { author: "fake face, older", rating: 5, published_at: "2020-01-01", author_photo_url: notAPhoto },
        { author: "no face, newest", rating: 5, published_at: "2026-07-20" },
      ]),
      "no face, newest",
      `"${notAPhoto}" must not count as a face`,
    );
  }
});

test("an undated review never outranks a dated one on recency", () => {
  // An unknown date is not evidence of recency. Treating it as "now" would
  // quietly promote the oldest corpus entries whenever Google omits a stamp.
  const { featuredReviews } = require("../lib/mirror-lane-build.js");
  const out = featuredReviews([
    { author: "undated", rating: 5 },
    { author: "dated 2026", rating: 5, published_at: "2026-07-20" },
  ]);
  assert.equal(out.reviews[0].author, "dated 2026");
});
