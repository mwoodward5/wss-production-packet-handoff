"use strict";

// test/verified-facts.test.js — THE CROSS-CHECK, LOCKED.
//
// The Genie fabricated a phone number and vouched for it itself. This suite
// locks the four properties that make that class of failure impossible to
// repeat, and one property that makes the cure survivable:
//
//   1. CONFLICT      two sources disagree -> nobody wins, the field is ABSENT.
//   2. SINGLE-SOURCE one source is enough only when that source is not the
//                    subject; the subject alone is enough only for what the
//                    subject is the authority on.
//   3. MISSING       nothing observed -> the field is absent, never defaulted.
//   4. GENIE BAN     the Genie can never be the corroborating source — not by
//                    observer, not by id, not by transport, not laundered
//                    through the bridge into from-genie.js.
//   5. SHAPE         what comes out actually validates as a MirrorRequest,
//                    because a 400 at the schema is how content became "none".
//
// Every source here is a stub. These tests make no network calls.

const test = require("node:test");
const assert = require("node:assert/strict");

const vf = require("../lib/mirror-engine/verified-facts");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { validateFacts } = require("../lib/mirror-engine/facts");

// --- stub source factory ----------------------------------------------------

function source(id, observer, observations, extra = {}) {
  return async () => ({
    id, observer, transport: extra.transport || "stub", status: extra.status || "ok",
    requests: 0, observations, ...extra,
  });
}

const GOOGLE = vf.OBSERVER.GOOGLE_GBP;
const SELF = vf.OBSERVER.BUSINESS_SELF;

const BASE = {
  business_name: "Jacksonville Roofing USA",
  city: "Jacksonville",
  state: "FL",
  industry: "roofing",
};

// ---------------------------------------------------------------------------
// 1. THE CONFLICT PATH
// ---------------------------------------------------------------------------

test("two sources disagreeing on a NAP field produce a conflict, and the field is ABSENT", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { business_name: BASE.business_name, city: "Jacksonville", state: "FL", phone: "(904) 516-4279" }, { place_types: ["roofing_contractor"] }),
      source("site", SELF, { phone: "(904) 000-1111" }),
    ],
  });

  const conflict = out.conflicts.find((c) => c.field === "phone");
  assert.ok(conflict, "a phone disagreement must be reported as a conflict");
  assert.equal(conflict.resolution, "absent");
  assert.equal(out.facts.phone, undefined, "a conflicted field must never appear in facts");
  assert.equal(out.provenance.phone, undefined, "a conflicted field must have no provenance");
  // Both observations are reported, so an operator can settle it by hand.
  assert.deepEqual(conflict.observations.map((o) => o.source).sort(), ["places", "site"]);
  // ok is false because phone is a required MirrorRequest fact.
  assert.equal(out.ok, false);
  assert.ok(out.missing_required.includes("phone"));
});

test("a conflict is never resolved by source order — reversing the sources changes nothing", async () => {
  const mk = (order) => vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: order,
  });
  const a = source("places", GOOGLE, { phone: "(904) 516-4279" });
  const b = source("site", SELF, { phone: "(904) 000-1111" });
  const first = await mk([a, b]);
  const second = await mk([b, a]);
  assert.equal(first.facts.phone, undefined);
  assert.equal(second.facts.phone, undefined);
  assert.equal(first.conflicts.length, second.conflicts.length);
});

test("formatting differences are NOT conflicts — the same number written two ways agrees", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279" }),
      source("panel", GOOGLE, { phone: "+1 904-516-4279" }, { transport: "serp" }),
      source("site", SELF, { phone: "9045164279" }),
    ],
  });
  assert.equal(out.conflicts.length, 0);
  assert.equal(out.facts.phone, "(904) 516-4279", "agreed value is normalised to one display form");
  assert.equal(out.provenance.phone.corroboration, "independent_corroborated");
});

test("hours that disagree between Google and the site go absent (the live Jacksonville case)", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, {
        phone: "(904) 516-4279",
        hours: ["Monday: Open 24 hours", "Tuesday: Open 24 hours"],
      }),
      source("site", SELF, { hours: ["Mon 08:00-17:00", "Tue 08:00-17:00"] }),
    ],
  });
  const conflict = out.conflicts.find((c) => c.field === "hours");
  assert.ok(conflict, "24/7 on Google vs 8-5 on the site is a real disagreement");
  assert.equal(out.content.hours, undefined, "unknown hours must not be rendered");
});

test("hours agree over the days BOTH sources describe; extra days on one side are silence, not conflict", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, {
        phone: "(904) 516-4279",
        hours: ["Monday: 8:00 AM – 5:00 PM", "Saturday: Closed", "Sunday: Closed"],
      }),
      source("site", SELF, { hours: ["Mon 08:00-17:00"] }),
    ],
  });
  assert.equal(out.conflicts.find((c) => c.field === "hours"), undefined);
  assert.ok(out.content.hours, "agreeing hours resolve");
});

test("a review count that drifted by one is not a conflict, and the LOWER count is kept", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279", rating: 5, review_count: 242 }),
      source("panel", GOOGLE, { rating: 5, review_count: 243 }, { transport: "serp" }),
    ],
  });
  assert.equal(out.conflicts.length, 0);
  assert.equal(out.facts.review_count, 242, "never overstate a review count");
});

test("a review count that differs wildly IS a conflict — that is two different businesses", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279", rating: 5, review_count: 242 }),
      source("panel", GOOGLE, { rating: 4.8, review_count: 25 }, { transport: "serp" }),
    ],
  });
  assert.ok(out.conflicts.some((c) => c.field === "review_count"));
  assert.ok(out.conflicts.some((c) => c.field === "rating"));
  assert.equal(out.facts.rating, undefined);
  assert.equal(out.facts.review_count, undefined);
});

// ---------------------------------------------------------------------------
// 2. THE SINGLE-SOURCE PATH
// ---------------------------------------------------------------------------

test("ONE independent source is enough for NAP — Places observes the business", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("places", GOOGLE, {
      business_name: BASE.business_name, city: "Jacksonville", state: "FL",
      phone: "(904) 516-4279", address: "6215-1 Wilson Blvd, Jacksonville, FL 32210",
    }, { place_types: ["roofing_contractor"] })],
  });
  assert.equal(out.ok, true);
  assert.equal(out.facts.phone, "(904) 516-4279");
  assert.equal(out.provenance.phone.corroboration, "single_independent");
});

test("the business's OWN SITE alone is NOT enough for a phone number", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("site", SELF, { phone: "(904) 516-4279", business_name: BASE.business_name })],
  });
  assert.equal(out.facts.phone, undefined, "an extractor reading one page is how the Genie invented a number");
  const held = out.withheld.find((w) => w.field === "phone");
  assert.ok(held);
  assert.equal(held.reason, "single_source_not_independent");
  assert.equal(out.ok, false);
});

test("the business's own site IS enough for the services it publishes about itself", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279" }),
      source("site", SELF, { services: [{ name: "Roof Waterproofing" }], faqs: [{ q: "Free estimates?", a: "Yes." }] }),
    ],
  });
  assert.equal(out.content.services.length, 1);
  assert.equal(out.provenance.services.corroboration, "single_self_published");
  assert.equal(out.provenance.faqs.corroboration, "single_self_published");
});

test("the business may not testify about its own reviews, even as the only source", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279" }),
      source("site", SELF, { rating: 5, review_count: 900, reviews: [{ text: "We are the best" }] }),
    ],
  });
  assert.equal(out.facts.rating, undefined);
  assert.equal(out.facts.review_count, undefined);
  assert.equal(out.content.reviews, undefined);
  // Disqualified at INGEST — it is not even compared, so it cannot conflict.
  assert.equal(out.conflicts.find((c) => c.field === "rating"), undefined);
  const held = out.withheld.find((w) => w.field === "rating");
  assert.equal(held.reason, "no_observation");
});

test("two transports of the SAME observer are labelled transport_corroborated, never independent", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279", rating: 5, review_count: 242 }, { transport: "places_api" }),
      source("panel", GOOGLE, { rating: 5, review_count: 242 }, { transport: "serp" }),
    ],
  });
  assert.equal(out.provenance.rating.corroboration, "transport_corroborated");
  assert.equal(out.coverage.independent_corroborated, 0);
});

test("a cached prospect row can neither corroborate nor conflict — a copy is not an observation", async () => {
  const withCache = await vf.resolveVerifiedFacts({
    prospect: { ...BASE, record: { phone: "(555) 555-5555", rating: 4.1, review_count: 9 } },
    sources: [
      source("places", GOOGLE, { phone: "(904) 516-4279" }),
      vf.cachedProspectRow,
    ],
  });
  assert.equal(withCache.facts.phone, "(904) 516-4279", "a stale cache must not veto a fresh observation");
  assert.equal(withCache.conflicts.find((c) => c.field === "phone"), undefined);
  assert.equal(withCache.provenance.phone.corroboration, "single_independent");
});

// ---------------------------------------------------------------------------
// 3. THE MISSING PATH
// ---------------------------------------------------------------------------

test("nothing observed means the field is absent — never blank, never defaulted", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("places", GOOGLE, { phone: "(904) 516-4279" })],
  });
  assert.equal("address" in out.facts, false);
  assert.equal("email" in out.facts, false);
  assert.equal(out.content.hours, undefined);
  assert.ok(out.withheld.some((w) => w.field === "address" && w.reason === "no_observation"));
});

test("every source failing yields ok:false with the missing required fields named", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, {}, { status: "provider_error", error: "http_500" }),
      source("site", SELF, {}, { status: "unavailable", error: "TimeoutError" }),
    ],
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.missing_required.sort(), ["business_name", "city", "phone", "state"]);
  assert.equal(Object.keys(out.facts).length, 1, "only the caller-claimed industry survives, and it is labelled unverified");
  assert.equal(out.provenance.industry.corroboration, "caller_claim_unverified");
});

test("a source that throws is reported, not swallowed, and resolves nothing", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [async () => { throw new Error("boom"); }],
  });
  assert.equal(out.sources[0].status, "threw");
  assert.equal(out.ok, false);
});

// ---------------------------------------------------------------------------
// 4. THE GENIE CAN NEVER BE THE CORROBORATING SOURCE
// ---------------------------------------------------------------------------

test("a Genie-observer source is banned: it supplies nothing and corroborates nothing", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("intake_packet", vf.OBSERVER.INTAKE_GENIE, { phone: "16872518405", rating: 4.9, review_count: 412 }),
      source("site", SELF, { business_name: BASE.business_name }),
    ],
  });
  const banned = out.sources.find((s) => s.id === "intake_packet");
  assert.equal(banned.status, "banned");
  assert.deepEqual(banned.fields, [], "a banned source's observations are dropped, not merely down-weighted");
  assert.equal(out.facts.phone, undefined, "the fabricated number must not resolve");
  assert.equal(out.facts.rating, undefined);
});

test("the Genie cannot make a self-published fact look corroborated", async () => {
  const withGenie = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("site", SELF, { phone: "(904) 516-4279" }),
      source("genie_packet", vf.OBSERVER.INTAKE_GENIE, { phone: "(904) 516-4279" }),
    ],
  });
  // The site alone is still not enough. A banned second source cannot promote it.
  assert.equal(withGenie.facts.phone, undefined);
  assert.equal(withGenie.withheld.find((w) => w.field === "phone").reason, "single_source_not_independent");
});

test("the ban is by NAME as well as observer — a Genie wearing a google_gbp badge is still banned", () => {
  assert.equal(vf.sourceIsBanned({ id: "intake_genie_v2", observer: GOOGLE, transport: "http" }), true);
  assert.equal(vf.sourceIsBanned({ id: "packet", observer: GOOGLE, transport: "siteforge_genie" }), true);
  assert.equal(vf.sourceIsBanned({ id: "places", observer: GOOGLE, transport: "places_api" }), false);
});

test("the from-genie bridge can never carry a source string the NAP gate accepts as the Genie", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("places", GOOGLE, { phone: "(904) 516-4279", rating: 5, review_count: 242 })],
  });
  const bridge = vf.toGenieBridge(out);
  assert.ok(bridge.verifiedNap.source);
  assert.equal(/genie/i.test(bridge.verifiedNap.source), false);
  assert.equal(/genie/i.test(bridge.verifiedReviews.source), false);
  // And from-genie.js's own gate agrees.
  const { genieToMirrorRequest } = require("../lib/mirror-engine/from-genie");
  const res = genieToMirrorRequest(
    { version: "intake-genie-v2", ok: true, facts: { name: BASE.business_name, city: "Jacksonville", state: "FL", category: "roofing", phone: "16872518405" } },
    { slug: "wss-test-jacksonville-roofing-usa-bridge", verifiedNap: bridge.verifiedNap, verifiedReviews: bridge.verifiedReviews },
  );
  assert.equal(res.ok, true);
  assert.equal(res.request.facts.phone, "(904) 516-4279", "the verified number wins; the packet's is dropped at the boundary");
  assert.ok(res.genie_nap_dropped.includes("phone"));
});

test("a rating with no review count behind it never reaches the request", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("places", GOOGLE, { business_name: BASE.business_name, city: "Jacksonville", state: "FL", phone: "(904) 516-4279", rating: 5 })],
  });
  const built = vf.toMirrorRequest(out, { slug: "wss-test-jacksonville-roofing-usa-x" });
  assert.equal(built.request.facts.rating, undefined);
  assert.equal(built.request.facts.review_count, undefined);
});

// ---------------------------------------------------------------------------
// 5. THE OUTPUT ACTUALLY VALIDATES
// ---------------------------------------------------------------------------

test("toMirrorRequest emits a request the engine's own validators accept", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [
      source("places", GOOGLE, {
        business_name: BASE.business_name, city: "Jacksonville", state: "FL",
        phone: "(904) 516-4279", address: "6215-1 Wilson Blvd, Jacksonville, FL 32210",
        postal_code: "32210", latitude: 30.27188, longitude: -81.7447117,
        place_id: "ChIJT2fj0LrL5YgR3Fhg7Ja_LPs",
        maps_url: "https://maps.google.com/?cid=1",
        rating: 5, review_count: 242,
        reviews: [
          // A real reviewer face, exactly as Places (New) serves one. The
          // uploaded-photo path is /a-/; /a/ACg8oc… is Google's generated
          // initial tile and is NOT a face (see isGoogleReviewerFace).
          {
            text: "Great crew, new roof in a week.", author: "Hannah Cee", rating: 5,
            author_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjWxHannahCee=s128-c0x00000000-cc-rp-mo",
            published_at: "2026-05-23T04:37:26.000Z", observed_time: 1779463046,
          },
          { text: "Fair pricing, on time.", author: "Casey Widell", rating: 5, observed_time: 1771462217 },
          { text: "Exceptional attention to detail.", author: "George Loper", rating: 5, observed_time: 1779315217 },
          { text: "Fourth.", author: "Nobody", rating: 5 },
          { text: "Fifth.", author: "Nobody Else", rating: 5 },
          { text: "A sixth review the schema has no room for.", author: "One Too Many", rating: 5 },
        ],
      }, { place_types: ["roofing_contractor"] }),
      source("site", SELF, { services: [{ name: "Roof Waterproofing" }], faqs: [{ q: "Free estimates?", a: "Yes." }] }),
    ],
  });

  const built = vf.toMirrorRequest(out, { slug: "wss-test-jacksonville-roofing-usa-shape", donor: "roofing-riseabove" });
  assert.equal(built.ok, true);

  // maps_url is resolved but MirrorFacts has no home for it, and the schema is
  // additionalProperties:false — an unprojected key is a hard 400 for the build.
  assert.equal("maps_url" in built.request.facts, false);
  // MirrorContent's declared cap is FIVE (mirror-request.schema.json
  // content.reviews maxItems). This shaper capped at three while the schema,
  // verified-trust-lookup.js and mirror-lane-build.js all said five, so the
  // resolver path quietly published two fewer real quotes than every other
  // path — and this assertion was pinning the wrong number in place.
  assert.equal(built.request.content.reviews.length, 5, "MirrorContent caps reviews at 5");
  assert.equal("observed_time" in built.request.content.reviews[0], false, "an extra review key would 400 the build");
  // THE FACE AND THE DATE TRAVEL WITH THE WORDS. Both were stripped by the
  // shaper, so a mirror could never show a reviewer's own photo however many
  // Google returned.
  const withFace = built.request.content.reviews.find((r) => r.author === "Hannah Cee");
  assert.equal(withFace.avatarUrl, "https://lh3.googleusercontent.com/a-/ALV-UjWxHannahCee=s128-c0x00000000-cc-rp-mo");
  assert.equal(withFace.publishedAt, "2026-05-23T04:37:26.000Z");
  assert.equal(
    built.request.content.reviews.filter((r) => r.avatarUrl).length, 1,
    "and no face is invented for the reviewers Google gave none for",
  );

  const structural = checkMirrorRequest(built.request);
  assert.equal(structural.ok, true, JSON.stringify(structural.body));
  const semantic = validateFacts(structural.request);
  assert.equal(semantic.ok, true, JSON.stringify(semantic.detail));
  assert.equal(semantic.phoneDigits, "9045164279");
});

test("a content object holding only truth_source is not attached — that is bookkeeping, not content", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("places", GOOGLE, { business_name: BASE.business_name, city: "Jacksonville", state: "FL", phone: "(904) 516-4279" }, { place_types: ["roofing_contractor"] })],
  });
  const built = vf.toMirrorRequest(out, { slug: "wss-test-jacksonville-roofing-usa-y", truthSource: "C:/evidence.json" });
  assert.equal(built.request.content, undefined);
});

// ---------------------------------------------------------------------------
// 6. TRADE-SWAP GUARD
// ---------------------------------------------------------------------------

test("Google's place type disagreeing with the claimed trade blocks the vertical", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: { ...BASE, industry: "plumbing" },
    sources: [source("places", GOOGLE, { business_name: BASE.business_name, city: "Jacksonville", state: "FL", phone: "(904) 516-4279" }, { place_types: ["roofing_contractor"] })],
  });
  const conflict = out.conflicts.find((c) => c.field === "industry");
  assert.ok(conflict, "an HVAC company must never ship as a plumber");
  assert.equal(out.vertical, null);
  assert.equal(out.facts.industry, undefined);
  assert.equal(out.ok, false, "no donor may be selected from an unresolved trade");
});

test("the observed place type wins the vertical when the caller agrees", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: BASE,
    sources: [source("places", GOOGLE, { business_name: BASE.business_name, city: "Jacksonville", state: "FL", phone: "(904) 516-4279" }, { place_types: ["roofing_contractor"] })],
  });
  assert.equal(out.vertical, "roofing");
  assert.equal(out.facts.industry, "roofing");
  assert.equal(out.provenance.industry.corroboration, "independent_corroborated");
});

// ---------------------------------------------------------------------------
// 7. COMPARATOR UNITS — the places a sloppy normalizer would invent agreement
// ---------------------------------------------------------------------------

test("address components present on both sides must match; a missing component is silence", () => {
  assert.equal(vf.addressAgrees("6215-1 Wilson Blvd, Jacksonville, FL 32210, USA", { streetAddress: "6215-1 Wilson Blvd", addressLocality: "Jacksonville", addressRegion: "FL", postalCode: "32210" }), true);
  assert.equal(vf.addressAgrees("6215-1 Wilson Blvd, Jacksonville, FL 32210", "9999 Other Rd, Jacksonville, FL 32210"), false);
  assert.equal(vf.addressAgrees("6215-1 Wilson Blvd", { addressLocality: "Jacksonville" }), false, "no shared component means nothing was compared");
});

test("a NANP number and its +1 form are the same number; a different number is not", () => {
  assert.equal(vf.normPhone("+1 904-516-4279"), "9045164279");
  assert.equal(vf.agrees("phone", "(904) 516-4279", "+1 904-516-4279"), true);
  assert.equal(vf.agrees("phone", "(904) 516-4279", "16872518405"), false, "the fabricated Facebook id is not this phone");
});

test("an unparsable hours line is dropped, never turned into a fake 'closed'", () => {
  const h = vf.normHours(["Monday: by appointment", "Tuesday: 8:00 AM - 5:00 PM"]);
  assert.equal("mon" in h, false);
  assert.equal(h.tue, "08:00-17:00");
});
