"use strict";

// test/mined-contract-reaches-the-build.test.js
//
// WHY THIS EXISTS, measured on the live fleet 2026-08-07.
//
// Three deployed mirrors served `rating:null, review_count:null, reviews:[],
// hours:null, areas:[]` while their own stored records held a Google rating and
// a review count — Carter's My Plumber (4.9 / 1,315), Rescue Rooter (4.2 / 151)
// and Plumbing Care (4.8 / 416). Every one of them still served the resolver's
// services and FAQ, which is the fingerprint: the fact RESOLVER ran, and the
// mined CONTRACT did not arrive.
//
// It did not arrive because only one of the two callers flattens it.
// line-adapters.prospectFromContract copies record.build_ready.mirror_request
// onto `verified_facts` / `verified_content`; full-run.prospectBuildInput
// carries `record` and nothing else. With no contract there is no `place_id`;
// with no place_id the trust lookup is skipped as
// `no_verified_place_id_to_pin_to`; and that one skipped call is the entire
// trust surface — reviews, hours and the Google profile link at once. The
// coordinates go with it, so withNearbyTowns returns unchanged content and the
// service-area list disappears too.
//
// Reproduced byte-for-byte before the fix: building each of those three through
// the full-run shape produced exactly the coverage its live page was serving
// (Carter's 12 services / 0 faqs, Rescue Rooter 8 / 2, Plumbing Care 12 / 5 —
// all three with 0 reviews, 0 hours, 0 nearby and no aggregate).
//
// The second half of this file pins the PIN. Rescue Rooter is why: it is a
// two-branch brand in one metro, "Rescue Rooter Portland OR" resolves to the
// CLACKAMAS branch (3,914 reviews against this branch's 151), and the pin
// correctly refused it — so the mirror shipped bare rather than wrong. The fix
// is a better QUESTION, never a weaker answer: ask by name + street address,
// keep exact place_id equality as the only thing that admits a record.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildMirrorForProspect, contentFromContract } = require("../lib/mirror-lane-build");
const { verifiedTrustForPlace } = require("../lib/verified-trust-lookup");

const PLACE_ID = "ChIJARzyGsasFIgRtWJ3VGwsyWA";
const ADDRESS = "450 E 96th St #500, Indianapolis, IN 46240, USA";

// The contract as the miner actually wrote it for Carter's: geo and place facts
// present, NO aggregate, hours but no reviews.
const CONTRACT = {
  facts: {
    business_name: "Carter's My Plumber",
    industry: "plumbing",
    city: "Indianapolis",
    state: "IN",
    phone: "(317) 893-2462",
    address: ADDRESS,
    postal_code: "46240",
    county: "Hamilton County",
    latitude: 39.9283287,
    longitude: -86.1504301,
    place_id: PLACE_ID,
    current_website: "https://www.cartersmyplumber.com/",
  },
  content: { hours: [{ day: "monday", text: "Open 24 hours" }] },
  brand: { logo: "https://www.cartersmyplumber.com/logo.png" },
};

const PINNED_TRUST = {
  ok: true,
  reviews: [{ text: "Same-day water heater swap, tidy work.", author: "Dana C.", rating: 5 }],
  hours: [{ day: "monday", text: "Open 24 hours" }],
  rating: 4.9,
  review_count: 1315,
  profile_url: "https://maps.google.com/?cid=6974154341745124021",
  diagnostics: { pinned_place_id: PLACE_ID },
};

function deps(overrides = {}) {
  const captured = {};
  return {
    captured,
    resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
    resolveVerifiedFacts: async () => ({ ok: true, facts: {}, content: { services: [{ name: "Drain Cleaning" }] } }),
    harvestClientPhotos: async () => ({ ok: false, photos: [] }),
    captureFonts: async () => ({ ok: false }),
    readIntakePacket: () => ({ ok: false }),
    mergeIntoContent: (content) => content,
    resolveRileyLine: () => ({ ok: false }),
    resolveSocials: async () => ({ socials: [], source: "not_attempted" }),
    verifiedTrustForPlace: async () => ({ ok: false, reason: "not_stubbed", reviews: [], hours: [], diagnostics: {} }),
    mirror: async (req) => {
      captured.req = req;
      return { status: 200, body: { ok: true, revealable: true, preview_url: "https://wss-test-x.wss-ai.com/", checks: {} } };
    },
    ...overrides,
  };
}

// The prospect EXACTLY as full-run.prospectBuildInput + dispatchMirrorLane's
// whitelist deliver it: the record, and none of the contract flattened out of
// it. This shape is the bug.
const FULL_RUN_PROSPECT = {
  prospect_id: "wss-test-carter-s",
  business_name: "Carter's My Plumber",
  industry: "plumbing",
  city: "Indianapolis",
  state: "IN",
  phone: "(317) 893-2462",
  site: "https://www.cartersmyplumber.com/",
  logo: "https://www.cartersmyplumber.com/logo.png",
  record: { build_ready: { mirror_request: CONTRACT } },
  // verified_facts / verified_content / rating / review_count: absent, as shipped.
};

// ---------------------------------------------------------------------------
// 1. THE CONTRACT REACHES THE BUILD FROM WHEREVER THE CALLER LEFT IT
// ---------------------------------------------------------------------------

test("a prospect carrying only the RECORD still reaches the pin — the full-run shape", async () => {
  let asked = null;
  const d = deps({ verifiedTrustForPlace: async (facts) => { asked = facts; return PINNED_TRUST; } });
  const out = await buildMirrorForProspect(FULL_RUN_PROSPECT, { deps: d, dryRun: true });

  assert.equal(out.ok, true);
  assert.notEqual(out.trust_lookup.status, "skipped", "this is the exact skip that emptied three live mirrors");
  assert.equal(out.trust_lookup.status, "pinned");
  assert.equal(asked.place_id, PLACE_ID, "the lookup is pinned to the contract's own place_id");
  assert.equal(out.facts.place_id, PLACE_ID);
  assert.equal(out.contentCoverage.reviews, 1, "Google's reviews for that place reach the page");
  assert.equal(out.contentCoverage.hours, 1);
});

test("the geo facts travel with it, so the service-area list is not silently emptied", async () => {
  const d = deps({ verifiedTrustForPlace: async () => PINNED_TRUST });
  const out = await buildMirrorForProspect(FULL_RUN_PROSPECT, { deps: d, dryRun: true });
  assert.equal(out.facts.address, ADDRESS);
  assert.equal(out.facts.postal_code, "46240");
  assert.equal(out.facts.county, "Hamilton County");
  assert.equal(out.facts.latitude, 39.9283287, "withNearbyTowns has nothing to work from without this");
  assert.equal(out.facts.longitude, -86.1504301);
});

test("contentFromContract reads the record's contract when nothing was flattened", () => {
  const content = contentFromContract({
    record: {
      build_ready: {
        mirror_request: {
          content: {
            reviews: [{ text: "Fast, fair, done right.", author: "Dana C.", rating: 5 }],
            hours: [{ day: "monday", text: "Open 24 hours" }],
          },
        },
      },
    },
  });
  assert.equal(content.reviews.length, 1);
  assert.equal(content.hours.length, 1);
});

test("a FLATTENED block still wins — the record is a fallback, never an override", async () => {
  // A caller that resolved the contract deliberately is fresher than stored
  // JSON. If the record could overrule it, this fix would be a regression
  // wearing a bug fix's clothes.
  const content = contentFromContract({
    verified_content: { reviews: [{ text: "The caller's own review.", author: "Flat", rating: 5 }] },
    record: {
      build_ready: {
        mirror_request: { content: { reviews: [{ text: "The stored review.", author: "Stored", rating: 5 }] } },
      },
    },
  });
  assert.equal(content.reviews.length, 1);
  assert.equal(content.reviews[0].author, "Flat");

  const d = deps({ verifiedTrustForPlace: async () => PINNED_TRUST });
  const out = await buildMirrorForProspect({
    ...FULL_RUN_PROSPECT,
    verified_facts: { ...CONTRACT.facts, place_id: "ChIJ_flattened_wins", address: "1 Flat St, Indianapolis, IN" },
  }, { deps: d, dryRun: true });
  assert.equal(out.facts.place_id, "ChIJ_flattened_wins");
});

test("no contract anywhere is still an honest refusal, not an invented pin", async () => {
  let called = 0;
  const d = deps({ verifiedTrustForPlace: async () => { called += 1; return PINNED_TRUST; } });
  const out = await buildMirrorForProspect({
    ...FULL_RUN_PROSPECT, record: null,
  }, { deps: d, dryRun: true });
  assert.equal(called, 0);
  assert.equal(out.trust_lookup.status, "skipped");
  assert.equal(out.trust_lookup.reason, "no_verified_place_id_to_pin_to");
  assert.equal(out.contentCoverage.reviews, 0, "absent, never invented");
});

// ---------------------------------------------------------------------------
// 2. THE STAR RAIL — the third thing that one request returns
// ---------------------------------------------------------------------------

test("the aggregate for the PINNED place fills a contract that never carried one", async () => {
  // Carter's contract holds hours and a place_id and no rating at all, while
  // its Google listing says 4.9 across 1,315 reviews. The figure was already in
  // the response we paid for and was being dropped on the floor.
  const d = deps({ verifiedTrustForPlace: async () => PINNED_TRUST });
  const out = await buildMirrorForProspect(FULL_RUN_PROSPECT, { deps: d, dryRun: true });
  assert.equal(out.facts.rating, 4.9);
  assert.equal(out.facts.review_count, 1315);
  assert.deepEqual(out.trust_lookup.aggregate_from_pinned_place, { rating: 4.9, review_count: 1315 });
  assert.equal(d.captured.req.facts.rating, 4.9, "and it reaches the request, not just the report");
});

test("a missing aggregate alone is worth the one call, and the report names it", async () => {
  let called = 0;
  const d = deps({
    verifiedTrustForPlace: async () => { called += 1; return PINNED_TRUST; },
  });
  const out = await buildMirrorForProspect({
    ...FULL_RUN_PROSPECT,
    verified_content: {
      reviews: [{ text: "Already held.", author: "A", rating: 5 }],
      hours: [{ day: "monday", text: "Open 24 hours" }],
    },
  }, { deps: d, dryRun: true });
  assert.equal(called, 1);
  assert.deepEqual(out.trust_lookup.wanted, ["rating"]);
  assert.equal(out.facts.rating, 4.9);
  assert.equal(out.contentCoverage.reviews, 1, "the corpus we already held is untouched — sections are never blended");
});

test("an aggregate we already hold is never overwritten by the lookup", async () => {
  const d = deps({ verifiedTrustForPlace: async () => ({ ...PINNED_TRUST, rating: 3.1, review_count: 9 }) });
  const out = await buildMirrorForProspect({
    ...FULL_RUN_PROSPECT,
    verified_facts: { ...CONTRACT.facts, rating: 4.9, review_count: 1315 },
  }, { deps: d, dryRun: true });
  assert.equal(out.facts.rating, 4.9);
  assert.equal(out.facts.review_count, 1315);
  assert.equal(out.trust_lookup.aggregate_from_pinned_place, undefined);
});

test("a REFUSED lookup writes no star and no count — fail closed", async () => {
  const d = deps({
    verifiedTrustForPlace: async () => ({
      ok: false, reason: "no_pinned_match_for_place_id", reviews: [], hours: [], rating: 4.8, review_count: 3914,
    }),
  });
  const out = await buildMirrorForProspect(FULL_RUN_PROSPECT, { deps: d, dryRun: true });
  assert.equal(out.trust_lookup.status, "refused");
  assert.equal(out.facts.rating, undefined, "a stranger's rating is not this client's rating at any confidence");
  assert.equal(out.facts.review_count, undefined);
});

// ---------------------------------------------------------------------------
// 3. THE PIN, AND THE BETTER QUESTION — never a weaker answer
// ---------------------------------------------------------------------------

const OPTS = { anonKey: "k", gatewayUrl: "https://example.supabase.co" };

function recordingGateway(byInput) {
  const asked = [];
  const fetchImpl = async (url) => {
    const input = new URL(url).searchParams.get("input");
    asked.push(input);
    return { ok: true, status: 200, json: async () => byInput[input] || {} };
  };
  return { asked, fetchImpl };
}

test("name + STREET ADDRESS is asked first — the key that tells two branches apart", async () => {
  // Measured against the live gateway on all 54 stored contracts holding both a
  // place_id and a street address: name+address landed the pinned place 54/54,
  // name+city+state 53/54. The one difference is Rescue Rooter.
  const RR = "ChIJmWujeb0LlVQRDGybIRPPzPE";
  const rrAddress = "1650 SE 3rd Ave #203, Portland, OR 97214, USA";
  const g = recordingGateway({
    [`Rescue Rooter ${rrAddress}`]: {
      placeId: RR,
      name: "Rescue Rooter",
      address: rrAddress,
      rating: 4.2,
      reviewCount: 151,
      lowConfidence: true,
      hoursText: ["Monday: Open 24 hours"],
      reviews: [{ text: "Out same night for a burst line.", authorName: "K. Hall", rating: 5 }],
    },
    // What name+city+state returns, and why this ordering exists: the Clackamas
    // branch, twelve miles away, with 3,914 reviews that are not this client's.
    "Rescue Rooter Portland OR": {
      placeId: "ChIJk0fCew52lVQREePFYwU2S5Y",
      name: "Rescue Rooter",
      address: "12430 SE Capps Rd, Clackamas, OR 97015, USA",
      rating: 4.8,
      reviewCount: 3914,
      reviews: [{ text: "Clackamas branch review", authorName: "Somebody Else", rating: 5 }],
    },
  });
  const out = await verifiedTrustForPlace({
    place_id: RR, business_name: "Rescue Rooter", address: rrAddress, city: "Portland", state: "OR",
  }, { ...OPTS, fetchImpl: g.fetchImpl });

  assert.equal(g.asked[0], `Rescue Rooter ${rrAddress}`, "the most specific key is asked first");
  assert.equal(g.asked.length, 1, "and when it lands, no second request is spent");
  assert.equal(out.ok, true);
  assert.equal(out.reviews[0].author, "K. Hall");
  assert.equal(out.rating, 4.2);
  assert.equal(out.review_count, 151);
});

test("the address key is still only a QUESTION — a mismatched id is refused exactly as before", async () => {
  const g = recordingGateway({
    [`Carter's My Plumber ${ADDRESS}`]: {
      placeId: "ChIJN_XEPstda4gRTEmYvihwzmw",
      name: "Carter's My Plumber",
      address: "886 N State Rd 135 Ste A, Greenwood, IN 46142, USA",
      rating: 4.9,
      reviewCount: 2810,
      reviews: [{ text: "Greenwood branch review", authorName: "Someone Else", rating: 5 }],
    },
  });
  const out = await verifiedTrustForPlace({
    place_id: PLACE_ID, business_name: "Carter's My Plumber", address: ADDRESS, city: "Indianapolis", state: "IN",
  }, { ...OPTS, fetchImpl: g.fetchImpl });

  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_pinned_match_for_place_id");
  assert.deepEqual(out.reviews, []);
  assert.equal(out.rating, undefined, "and no aggregate escapes a refused lookup either");
  assert.equal(out.diagnostics.queries[0].status, "place_id_mismatch");
});

test("with no address on the contract the keys are exactly what they always were", async () => {
  const g = recordingGateway({});
  await verifiedTrustForPlace({
    place_id: PLACE_ID,
    business_name: "Carter's My Plumber",
    city: "Indianapolis",
    state: "IN",
    current_website: "https://www.cartersmyplumber.com/",
  }, { ...OPTS, fetchImpl: g.fetchImpl });
  assert.deepEqual(g.asked, ["Carter's My Plumber Indianapolis IN", "https://www.cartersmyplumber.com/"]);
});

test("the aggregate is returned as a PAIR or not at all", async () => {
  const half = await verifiedTrustForPlace({
    place_id: PLACE_ID, business_name: "Carter's My Plumber", city: "Indianapolis", state: "IN",
  }, {
    ...OPTS,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ placeId: PLACE_ID, rating: 4.9, reviewCount: 0, reviews: [{ text: "x", authorName: "y", rating: 5 }] }),
    }),
  });
  assert.equal(half.ok, true);
  assert.equal(half.rating, undefined, "a star with no count is a claim nobody can check");
  assert.equal(half.review_count, undefined);
});
