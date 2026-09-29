"use strict";

// test/bare-template-and-the-place-pin.test.js
//
// THE DEFECT THIS SUITE CLOSES. In the owner's Oregon run three leads —
// D&F Plumbing, Jam Plumbing and Rescue Rooter — deployed with
// checks.content.status === "none": zero injected sections, a 5,533-character
// home page against ~8,100 for the leads that got content. A donor template
// wearing the client's logo, shipped under an email promising a new website,
// past ten green gates.
//
// Four separate causes were measured live on 2026-08-06. Each has a section
// here:
//
//   1. THE PIN. placesViaCallPrep threw away a CORRECT Google record because
//      the gateway said `lowConfidence` about its own text match — while the
//      caller was holding the very place_id that settles it and nothing read
//      it. And with no pin, a confident WRONG match had no identity check at
//      all.
//   2. THE DROPPED FAQ. contentFromVerified shaped services, reviews and hours
//      and silently discarded `faqs` — the client's own questions and answers.
//   3. UNREADABLE IS NOT DISAGREEING. A site whose opening-hours string could
//      not be parsed was treated as CONTRADICTING Google, which deleted
//      Google's perfectly good hours.
//   4. THE FLOOR. Nothing anywhere asked whether the page had any content at
//      all before calling it deliverable.
//
// Every source is a stub. These tests make no network calls.

const test = require("node:test");
const assert = require("node:assert/strict");

const vf = require("../lib/mirror-engine/verified-facts");
const {
  buildMirrorForProspect,
  contentFloorReport,
  contentFromVerified,
} = require("../lib/mirror-lane-build");
const { targetedContentChannels } = require("../lib/mirror-engine/verify");

// ---------------------------------------------------------------------------
// 1. THE PIN — placesViaCallPrep answers `lowConfidence` instead of obeying it
// ---------------------------------------------------------------------------

const PIN = "ChIJAQAAAHCvlVQRY8yyscB2s0g";       // D&F Plumbing, Portland OR
const OTHER = "ChIJk0fCew52lVQREePFYwU2S5Y";     // Rescue Rooter, Clackamas OR

// The gateway's live answer for D&F: the right place, flagged unsure.
function gateway(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

function withGatewayEnv(fn) {
  const before = {
    url: process.env.CALLPREP_SUPABASE_URL,
    key: process.env.CALLPREP_SUPABASE_ANON_KEY,
  };
  process.env.CALLPREP_SUPABASE_URL = "https://example.supabase.co";
  process.env.CALLPREP_SUPABASE_ANON_KEY = "anon-key";
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (before.url === undefined) delete process.env.CALLPREP_SUPABASE_URL;
      else process.env.CALLPREP_SUPABASE_URL = before.url;
      if (before.key === undefined) delete process.env.CALLPREP_SUPABASE_ANON_KEY;
      else process.env.CALLPREP_SUPABASE_ANON_KEY = before.key;
    });
}

const DF_PAYLOAD = Object.freeze({
  placeId: PIN,
  name: "D&F Plumbing, Heating and Cooling",
  address: "650 NE Holladay St Ste 1600, Portland, OR 97232, USA",
  city: "Portland",
  website: "https://dandfplumbing.com/",
  phone: "(503) 664-0938",
  rating: 4.5,
  reviewCount: 2186,
  // The gateway genuinely cannot tell a multi-branch brand apart from text.
  lowConfidence: true,
  hoursText: ["Monday: Open 24 hours", "Tuesday: Open 24 hours"],
  reviews: [{ text: "Fixed the main line same day.", authorName: "Pat R.", rating: 5 }],
});

test("a lowConfidence answer that IS our pinned place is accepted — the pin settles it", async () => {
  await withGatewayEnv(async () => {
    const rec = await vf.placesViaCallPrep({
      business_name: "D&F Plumbing, Heating and Cooling",
      city: "Portland",
      state: "OR",
      website: "https://dandfplumbing.com/",
      place_id: PIN,
      fetchImpl: gateway(DF_PAYLOAD),
    });
    assert.equal(rec.status, "ok", "the gateway was unsure WHICH place; we already knew which place");
    assert.equal(rec.observations.rating, 4.5);
    assert.equal(rec.observations.review_count, 2186);
    assert.equal(rec.observations.reviews.length, 1);
    assert.equal(rec.observations.hours.length, 2);
    assert.equal(rec.match.pinned, true, "the audit trail says the PIN admitted this, not a threshold");
    assert.equal(rec.match.gateway_low_confidence, true, "and records that the gateway itself was unsure");
  });
});

test("the same answer with NO pin supplied is still refused — behaviour is unchanged for callers without one", async () => {
  await withGatewayEnv(async () => {
    const rec = await vf.placesViaCallPrep({
      business_name: "D&F Plumbing, Heating and Cooling",
      city: "Portland",
      state: "OR",
      website: "https://dandfplumbing.com/",
      fetchImpl: gateway(DF_PAYLOAD),
    });
    assert.equal(rec.status, "match_unconfirmed");
    assert.deepEqual(rec.observations, {}, "an unconfirmed match contributes nothing");
  });
});

test("a DIFFERENT place is refused however confident the gateway is — the Clackamas branch case", async () => {
  await withGatewayEnv(async () => {
    const rec = await vf.placesViaCallPrep({
      business_name: "Rescue Rooter",
      city: "Portland",
      state: "OR",
      // Pinned to the Portland listing the miner verified by domain...
      place_id: "ChIJmWujeb0LlVQRDGybIRPPzPE",
      fetchImpl: gateway({
        // ...and the text lookup lands on the Clackamas branch, twelve miles away.
        placeId: OTHER,
        name: "Rescue Rooter",
        address: "12430 SE Capps Rd, Clackamas, OR 97015, USA",
        phone: "(503) 555-0000",
        rating: 4.6,
        reviewCount: 900,
        // Deliberately CONFIDENT. Before the pin, nothing refused this.
        lowConfidence: false,
        reviews: [{ text: "Another branch's review", authorName: "Someone Else", rating: 5 }],
      }),
    });
    assert.equal(rec.status, "place_id_mismatch");
    assert.equal(rec.returned_place_id, OTHER);
    assert.deepEqual(rec.observations, {}, "a stranger's phone and reviews never reach the client's page");
  });
});

test("a pinned place whose listing now points at another domain is refused", async () => {
  await withGatewayEnv(async () => {
    const rec = await vf.placesViaCallPrep({
      business_name: "D&F Plumbing, Heating and Cooling",
      city: "Portland",
      state: "OR",
      website: "https://dandfplumbing.com/",
      place_id: PIN,
      fetchImpl: gateway({ ...DF_PAYLOAD, website: "https://someone-else.example/" }),
    });
    assert.equal(rec.status, "website_host_mismatch");
    assert.equal(rec.mined_host, "dandfplumbing.com");
    assert.equal(rec.returned_host, "someone-else.example");
    assert.deepEqual(rec.observations, {});
  });
});

test("a pinned lookup with no id to check against is not a match", async () => {
  await withGatewayEnv(async () => {
    const rec = await vf.placesViaCallPrep({
      business_name: "D&F Plumbing, Heating and Cooling",
      city: "Portland",
      state: "OR",
      place_id: PIN,
      fetchImpl: gateway({ name: "D&F Plumbing", rating: 4.5, reviewCount: 2186 }),
    });
    assert.equal(rec.status, "match_unconfirmed");
    assert.deepEqual(rec.observations, {});
  });
});

test("resolveVerifiedFacts carries the caller's place_id into the adapters", async () => {
  // It was accepted by every caller and read by nothing, which is why every
  // Google lookup fell back to a text match it could not confirm.
  let seen = null;
  await vf.resolveVerifiedFacts({
    prospect: { business_name: "X", city: "Y", state: "OR", place_id: PIN },
    sources: [async (ctx) => {
      seen = ctx.place_id;
      return { id: "spy", observer: vf.OBSERVER.GOOGLE_GBP, status: "no_match", requests: 0, observations: {} };
    }],
  });
  assert.equal(seen, PIN);
});

test("the caller's place_id is a KEY, never an answer — it cannot resolve itself into facts", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: { business_name: "X", city: "Y", state: "OR", place_id: PIN },
    sources: [async () => ({ id: "silent", observer: vf.OBSERVER.GOOGLE_GBP, status: "no_match", requests: 0, observations: {} })],
  });
  assert.equal(out.facts.place_id, undefined, "an unobserved place_id is absent, not echoed back from input");
});

// ---------------------------------------------------------------------------
// 2. UNREADABLE IS NOT DISAGREEING — the Jam Plumbing hours case
// ---------------------------------------------------------------------------

test("an hours string nobody can parse is SILENCE, and Google's real hours survive it", async () => {
  // Jam Plumbing's own site declares one comma-joined schema.org token that
  // normHours() cannot read. It does not contradict Google; it says nothing.
  const out = await vf.resolveVerifiedFacts({
    prospect: { business_name: "Jam Plumbing", city: "Portland", state: "OR" },
    sources: [
      async () => ({
        id: "google", observer: vf.OBSERVER.GOOGLE_GBP, transport: "t", status: "ok", requests: 0,
        observations: { hours: ["Monday: 7:00 AM – 5:00 PM", "Tuesday: 7:00 AM – 5:00 PM"] },
      }),
      async () => ({
        id: "site", observer: vf.OBSERVER.BUSINESS_SELF, transport: "t", status: "ok", requests: 0,
        observations: { hours: ["Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday 00:00-23:59"] },
      }),
    ],
  });
  assert.equal(out.conflicts.some((c) => c.field === "hours"), false, "silence must not manufacture a conflict");
  assert.equal(out.content.hours.length, 2, "the readable observation stands");
  assert.equal(out.provenance.hours.corroboration, "single_independent");
});

test("two READABLE hours blocks that genuinely differ still conflict, and hours go absent", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: { business_name: "X", city: "Portland", state: "OR" },
    sources: [
      async () => ({
        id: "google", observer: vf.OBSERVER.GOOGLE_GBP, transport: "t", status: "ok", requests: 0,
        observations: { hours: ["Monday: 7:00 AM – 5:00 PM"] },
      }),
      async () => ({
        id: "site", observer: vf.OBSERVER.BUSINESS_SELF, transport: "t", status: "ok", requests: 0,
        observations: { hours: ["Mon 09:00-13:00"] },
      }),
    ],
  });
  assert.equal(out.conflicts.some((c) => c.field === "hours"), true);
  assert.equal(out.content.hours, undefined, "posting the wrong hours costs a real call");
});

// ---------------------------------------------------------------------------
// 3. THE CLIENT'S OWN FAQ SURVIVES THE SHAPER
// ---------------------------------------------------------------------------

test("contentFromVerified carries the client's own FAQs — it used to drop them all", () => {
  const out = contentFromVerified({
    services: [{ name: "Drain cleaning" }],
    faqs: [
      { q: "Do you offer emergency service?", a: "Yes, 24 hours a day." },
      { question: "Are you licensed?", answer: "Licensed, bonded and insured in Oregon." },
      { q: "", a: "an answer to no question" },
    ],
  });
  assert.equal(out.faqs.length, 2, "both real pairs, and only the real pairs");
  assert.equal(out.faqs[0].q, "Do you offer emergency service?");
  assert.equal(out.faqs[1].a, "Licensed, bonded and insured in Oregon.");
});

test("the FAQ shaper caps at what the renderer will show and never invents a pair", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
  assert.equal(contentFromVerified({ faqs: many }).faqs.length, 20);
  assert.equal(contentFromVerified({ faqs: [] }).faqs, undefined, "no FAQs is an absent section");
});

// ---------------------------------------------------------------------------
// 3b. THE REVIEWER'S FACE — plumbed end to end against a stubbed photoUri
// ---------------------------------------------------------------------------
//
// Reviewer faces are 0 on every live mirror because this machine's Google
// Places key answers API_KEY_SERVICE_BLOCKED for Places API (New) — the ONLY
// transport that carries authorAttribution.photoUri. That is an environment
// problem. These tests prove the CODE is ready for the moment it is fixed, by
// feeding the exact payload Places returns and following a face all the way to
// the request handed to mirror().
//
// The absolute rule underneath: nothing anywhere substitutes or generates a
// face. Where Google supplied none, none appears.

const REAL_FACE = "https://lh3.googleusercontent.com/a-/ALV-UjV1RealPhoto=s128-c0x00000000-cc-rp-mo";
const INITIAL_TILE = "https://lh3.googleusercontent.com/a/ACg8ocGeneratedInitial=s128-c0x00000000-cc-rp-mo";

test("placesDirect reads authorAttribution.photoUri — faces arrive the moment the key works", async () => {
  const before = process.env.GOOGLE_PLACES_API_KEY;
  process.env.GOOGLE_PLACES_API_KEY = "test-key";
  try {
    const rec = await vf.placesDirect({
      business_name: "D&F Plumbing, Heating and Cooling",
      city: "Portland",
      state: "OR",
      place_id: PIN,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          places: [{
            id: PIN,
            displayName: { text: "D&F Plumbing, Heating and Cooling" },
            nationalPhoneNumber: "(503) 664-0938",
            reviews: [
              {
                text: { text: "Fixed the main line same day." },
                rating: 5,
                publishTime: "2026-07-02T18:04:11Z",
                authorAttribution: { displayName: "Pat R.", photoUri: REAL_FACE },
              },
              {
                text: { text: "Good work." },
                rating: 5,
                authorAttribution: { displayName: "Chris L.", photoUri: INITIAL_TILE },
              },
            ],
          }],
        }),
      }),
    });
    assert.equal(rec.status, "ok");
    assert.equal(rec.observations.reviews[0].author_photo_url, REAL_FACE);
    assert.equal(rec.observations.reviews[0].published_at, "2026-07-02T18:04:11Z");
  } finally {
    if (before === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = before;
  }
});

test("a generated initial tile is NOT a face, and is not carried as one", async () => {
  const out = await vf.resolveVerifiedFacts({
    prospect: { business_name: "X", city: "Portland", state: "OR" },
    sources: [async () => ({
      id: "google", observer: vf.OBSERVER.GOOGLE_GBP, transport: "t", status: "ok", requests: 0,
      observations: {
        reviews: [
          { text: "Real face.", author: "Pat R.", rating: 5, author_photo_url: REAL_FACE },
          { text: "Initial tile.", author: "Chris L.", rating: 5, author_photo_url: INITIAL_TILE },
          { text: "No photo at all.", author: "Sam T.", rating: 5 },
        ],
      },
    })],
  });
  const [a, b, c] = out.content.reviews;
  assert.equal(a.avatarUrl, REAL_FACE);
  assert.equal(b.avatarUrl, undefined, "a coloured circle with an initial in it is not a person");
  assert.equal(c.avatarUrl, undefined, "and an absent face stays absent — nothing is generated");
  assert.equal(b.text, "Initial tile.", "the words and the name still ship either way");
});

test("a face survives the resolver shaper AND the lane shaper, into the built request", async () => {
  const { deps, state } = floorDeps({
    reviews: [
      { text: "No face here.", author: "Sam T.", rating: 5, publishedAt: "2026-07-01T00:00:00Z" },
      { text: "Fixed the main line same day.", author: "Pat R.", rating: 5, avatarUrl: REAL_FACE, publishedAt: "2026-06-01T00:00:00Z" },
    ],
  });
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  const shipped = state.request.content.reviews;
  assert.equal(shipped.length, 2);
  // Owner's order: a face first, THEN the newest. The faceless review is newer
  // and still ranks second.
  assert.equal(shipped[0].author, "Pat R.", "the review with a real face leads");
  assert.equal(shipped[0].avatarUrl, REAL_FACE, "and its face reached the request, not just the resolver");
  assert.equal(shipped[0].publishedAt, "2026-06-01T00:00:00Z");
  assert.equal(shipped[1].avatarUrl, undefined);
  assert.equal(out.contentCoverage.faces, 1, "and the build report counts it");
});

test("with no faces at all the order falls back to newest, then best", async () => {
  const { deps, state } = floorDeps({
    reviews: [
      { text: "Older.", author: "A", rating: 5, publishedAt: "2025-01-01T00:00:00Z" },
      { text: "Newer.", author: "B", rating: 4, publishedAt: "2026-06-01T00:00:00Z" },
    ],
  });
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(state.request.content.reviews[0].author, "B");
  assert.equal(out.contentCoverage.faces, 0, "zero faces is reported as zero, never padded");
});

// ---------------------------------------------------------------------------
// 3c. A SERVICE NAME, NOT A SEARCH-ENGINE HEADLINE
// ---------------------------------------------------------------------------
//
// Rendered on the live Jam Plumbing mirror, 2026-08-06: twelve service cards
// that were really seven services, five of them printed twice — once as a
// label and once with " in Portland OR" stapled on. The duplicate reads as a
// broken template, and the bare trailing state code trips the render gate's
// line_ends_with_connector rule, which fails route_render, which made the whole
// mirror unrevealable. Jam shipped as nothing at all because of it.

test("the SEO locality suffix comes off a service name, and the duplicate collapses", () => {
  assert.equal(vf.stripTrailingLocality("Whole Home Repiping Services in Portland OR"), "Whole Home Repiping Services");
  assert.equal(vf.stripTrailingLocality("Water Heater Services in Portland, OR"), "Water Heater Services");
  assert.equal(vf.stripTrailingLocality("Slab Leak Repair serving West Palm Beach FL"), "Slab Leak Repair");
  assert.equal(vf.stripTrailingLocality("Drain Cleaning near Oregon City OR"), "Drain Cleaning");
});

test("removal only — a name that is not a locality assertion keeps every word", () => {
  for (const kept of [
    "Emergency Service in a Hurry",   // "a Hurry" is not a state
    "AC Repair for Homeowners",
    "Plumbing in Portland",           // no state code, so not an assertion
    "Repiping",
    "in TX",                          // trimming would leave nothing meaningful
  ]) {
    assert.equal(vf.stripTrailingLocality(kept), kept);
  }
});

test("a nested /reviews or /coupons page is not a service — the anchored blocklist missed every one", () => {
  // Rescue Rooter's whole site hangs off a branch prefix, so the start-anchored
  // rule never fired and the mirror printed "Reviews", "Coupons", "About Us"
  // and "Book Appointment" as service cards.
  for (const blocked of [
    "/rescue-rooter-jack-howk-portland/reviews",
    "/rescue-rooter-jack-howk-portland/coupons",
    "/rescue-rooter-jack-howk-portland/service-areas",
    "/rescue-rooter-jack-howk-portland/about-us",
    "/rescue-rooter-jack-howk-portland/book-appointment",
  ]) {
    assert.equal(vf.isNonServicePath(blocked), true, blocked);
  }
});

test("a real service page is still a service, however deeply it is nested", () => {
  for (const kept of [
    "/services/drain-cleaning",
    "/sewer-line-service",
    "/plumbing/water-heater-repair",
    // A multi-city contractor publishes its services UNDER a city hub. The new
    // segment rule deliberately omits `locations` so these survive: refusing
    // them would strip the service list off the businesses that have the most
    // of them, and then fail those leads at the content floor for having none.
    "/portland-branch/locations/drain-cleaning",
  ]) {
    assert.equal(vf.isNonServicePath(kept), false, kept);
  }
});

test("the corporate footer is refused by LABEL, because a path blocklist cannot see it", async () => {
  // A franchise portal routes "Do Not Sell My Personal Information" through
  // whatever slug its CMS generated, and every entry blocked by path just
  // promotes the next footer link into the twelve-card cap. Rendered live on
  // the Rescue Rooter mirror, the client's service list ended: "Supplier
  // Support | Glossary | Accessibility | Do Not Sell My Personal Information".
  const html = `<html><body><nav>
    <a href="/x1">Drain Cleaning</a>
    <a href="/x2">Water Heater Repair</a>
    <a href="/x3">Accessibility</a>
    <a href="/x4">Do Not Sell My Personal Information</a>
    <a href="/x5">Glossary</a>
    <a href="/x6">Supplier Support</a>
    <a href="/x7">Media Kit</a>
    <a href="/x8">Accessibility Remodeling</a>
  </nav></body></html>`;
  const rec = await vf.firstPartySite({
    website: "https://franchise.example/",
    business_name: "Rescue Rooter",
    city: "Portland",
    state: "OR",
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }),
  });
  const names = rec.observations.services.map((s) => s.name);
  assert.deepEqual(names, ["Drain Cleaning", "Water Heater Repair", "Accessibility Remodeling"],
    "the four corporate pages go, and a real service that merely STARTS with a blocked word stays");
});

test("a label that is only the market plus the trade is a hub link, not a service", () => {
  // Rendered as service card 07 on the live Rescue Rooter mirror: "Portland
  // plumber". It tells a visitor to a Portland plumber's website nothing the
  // heading above it did not.
  for (const hub of ["Portland plumber", "Plumbing Services", "Plumbers Near Me"]) {
    assert.equal(vf.isHubLabel(hub, "Portland", "OR"), true, hub);
  }
  assert.equal(vf.isHubLabel("Oregon City Plumbing", "Oregon City", "OR"), true, "a two-word city is matched whole");
});

test("anything with a real service word left in it survives", () => {
  for (const kept of [
    "Portland Emergency Plumbing",
    "Drain Cleaning Service",
    "Commercial Plumbing Services",
    "Water Heater Repair",
    "sewer line repair",
  ]) {
    assert.equal(vf.isHubLabel(kept, "Portland", "OR"), false, kept);
  }
});

test("the widened rule adds nested cases WITHOUT widening the anchored one", () => {
  // A site rooted at /locations is a directory, and the start-anchored rule has
  // always refused it. That behaviour is unchanged — this suite only claims the
  // nested marketing pages are new.
  assert.equal(vf.isNonServicePath("/locations/portland/drain-cleaning"), true, "unchanged: anchored rule still owns a /locations root");
});

// ---------------------------------------------------------------------------
// 4. THE CONTENT FLOOR
// ---------------------------------------------------------------------------

const INJECTED = { checks: { content: { status: "injected", sections: 4 } } };

test("one substance channel plus one emitted section clears the floor", () => {
  const out = contentFloorReport({ services: [{ name: "Drain cleaning" }] }, INJECTED);
  assert.equal(out.status, "passed");
  assert.equal(out.verdict, "met");
  assert.deepEqual(out.channels, ["services"]);
});

test("ZERO client content fails the floor — this is the Oregon defect, named", () => {
  const out = contentFloorReport({}, INJECTED);
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "no_verified_content");
  assert.match(out.reason, /donor template wearing their logo/);
});

test("nearby towns alone do NOT clear the floor — the generated-FAQ loophole stays shut", () => {
  // A request carrying only `nearby` still makes content-inject emit a trust
  // rail and a generated FAQ section, so counting emitted sections alone would
  // call a contentless page a pass.
  const out = contentFloorReport({ nearby: [{ name: "Beaverton", state: "OR", miles: 7 }] }, INJECTED);
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "no_verified_content");
  assert.equal(out.nearby, 1, "and the towns are still reported, because they did ship");
});

test("content that resolved but reached no section is reported as LOST, not as met", () => {
  const out = contentFloorReport(
    { services: [{ name: "Drain cleaning" }] },
    { checks: { content: { status: "none", sections: 0 } } },
  );
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
  assert.match(out.reason, /emitted HTML carries no injected section/);
});

test("a donor-native service section clears the floor from its emitted content island", () => {
  const out = contentFloorReport(
    { services: [{ name: "Drain cleaning" }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          services: 1,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services", "faq", "coverage"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: { services: { supplied: 1, rendered: 1, target_checked: true, baseline_checked: true, target_changed: true } },
          }],
        },
      },
    },
  );
  assert.equal(out.status, "passed");
  assert.equal(out.verdict, "met");
  assert.equal(out.render_mode, "donor_native");
  assert.deepEqual(out.native_channels, ["services"]);
  assert.equal(out.sections, 0, "native rendering is not relabelled as an appended section");
});

test("service words outside the manifest-owned service section do not clear the floor", () => {
  const outsideOnly = targetedContentChannels({
    services: {
      supplied: 2,
      _expected: ["home repair", "emergency repairs"],
      _target_text: "General contracting project planning",
      _baseline_target_text: "General contracting project planning",
      target_checked: true,
      baseline_checked: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 1,
    },
  });

  assert.deepEqual(outsideOnly.services, {
    supplied: 2,
    rendered: 0,
    target_checked: true,
    baseline_checked: true,
    target_changed: false,
    targets_expected: 1,
    targets_found: 1,
    baseline_targets_found: 1,
  });
  const inside = targetedContentChannels({
    services: {
      supplied: 1,
      _expected: ["emergency repairs"],
      _target_text: "Emergency Repairs",
      _baseline_target_text: "",
      target_checked: true,
      baseline_checked: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 0,
    },
  });
  assert.equal(inside.services.rendered, 1);
  assert.equal(inside.services.target_changed, true);
});

test("static donor service words cannot impersonate a working native bridge", () => {
  const deadBridge = targetedContentChannels({
    services: {
      supplied: 1,
      _expected: ["drain cleaning"],
      _target_text: "Drain Cleaning",
      _baseline_target_text: "Drain Cleaning",
      target_checked: true,
      baseline_checked: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 1,
    },
  });
  assert.equal(deadBridge.services.rendered, 0);
  assert.equal(deadBridge.services.target_changed, false);

  const liveBridge = targetedContentChannels({
    services: {
      supplied: 1,
      _expected: ["drain cleaning"],
      _target_text: "Drain Cleaning\nDrain Cleaning",
      _baseline_target_text: "Drain Cleaning",
      target_checked: true,
      baseline_checked: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 1,
    },
  });
  assert.equal(liveBridge.services.rendered, 1);
  assert.equal(liveBridge.services.target_changed, true);
});

test("unrelated native wrapper changes cannot borrow a service phrase from the baseline", () => {
  const wrapperOnly = targetedContentChannels({
    services: {
      supplied: 1,
      _expected: ["drain cleaning"],
      _target_text: "Drain Cleaning New dynamic wrapper",
      _baseline_target_text: "Drain Cleaning",
      target_checked: true,
      baseline_checked: true,
      targets_expected: 1,
      targets_found: 1,
      baseline_targets_found: 1,
    },
  });

  assert.equal(wrapperOnly.services.target_changed, true);
  assert.equal(wrapperOnly.services.rendered, 0);
});

test("a broken donor-native bridge cannot clear the floor from manifest assertions", () => {
  const out = contentFloorReport(
    { services: [{ name: "Drain cleaning" }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          services: 1,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services"],
        },
        route_render: {
          status: "passed",
          pages: [{
            path: "/",
            content_channels: { services: { supplied: 1, rendered: 0 } },
          }],
        },
      },
    },
  );
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
});

test("a failed route render cannot clear the donor-native floor from partial page evidence", () => {
  const out = contentFloorReport(
    { services: [{ name: "Drain cleaning" }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          data_island: true,
          donor_consumes_content: true,
          donor_renders: ["services"],
        },
        route_render: {
          status: "failed",
          pages: [{
            path: "/",
            content_channels: { services: { supplied: 1, rendered: 1 } },
          }],
        },
      },
    },
  );
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
});

test("a content island alone cannot clear the floor without a donor manifest binding", () => {
  const out = contentFloorReport(
    { services: [{ name: "Drain cleaning" }] },
    {
      checks: {
        content: {
          status: "none",
          sections: 0,
          services: 1,
          data_island: true,
          donor_consumes_content: false,
          donor_renders: ["services"],
        },
      },
    },
  );
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "lost");
});

test("a build that never ran content injection is not credited with content", () => {
  const out = contentFloorReport({ reviews: [{ text: "x" }] }, { checks: {} });
  assert.equal(out.status, "failed");
  assert.equal(out.verdict, "not_injected");
});

test("any ONE of the six substance channels is enough — the floor is deliberately low", () => {
  for (const [key, value] of [
    ["services", [{ name: "s" }]],
    ["reviews", [{ text: "t" }]],
    ["hours", [{ day: "monday", text: "9-5" }]],
    ["faqs", [{ q: "q", a: "a" }]],
    ["areas", ["Beaverton"]],
    ["about", "Family owned since 1974."],
  ]) {
    assert.equal(contentFloorReport({ [key]: value }, INJECTED).status, "passed", `${key} alone should clear the floor`);
  }
});

// --- and the floor as the build actually applies it -------------------------

const PROSPECT = Object.freeze({
  prospect_id: "wss-test-floor-fixture",
  business_name: "Floor Fixture Plumbing",
  industry: "plumbing",
  city: "Portland",
  state: "OR",
  site: "https://floorfixture.example/",
  logo: "https://floorfixture.example/logo.png",
  phone: "(503) 555-0100",
});

function floorDeps(content, { sections } = {}) {
  const state = {};
  return {
    state,
    deps: {
      resolveBuildableDonor: () => ({ ok: true, donor: "plumbing-clean", vertical: "plumbing" }),
      resolveVerifiedFacts: async () => ({ ok: true, facts: {}, content }),
      harvestClientPhotos: async () => ({ ok: false, photos: [] }),
      verifiedTrustForPlace: async () => ({ ok: false, reason: "no_verified_place_id_to_pin_to", reviews: [], hours: [] }),
      mirror: async (req) => {
        state.request = req;
        const n = sections !== undefined ? sections : (req.content && Object.keys(req.content).length ? 4 : 0);
        return {
          status: 200,
          body: {
            ok: true,
            revealable: true,
            preview_url: `https://${req.slug}.wss-ai.com/`,
            checks: { content: { status: n ? "injected" : "none", sections: n } },
          },
        };
      },
    },
  };
}

test("a mirror with no content of the client's own is NOT revealable, and says why", async () => {
  const { deps } = floorDeps({});
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(out.ok, true, "the BUILD succeeded — this is a product verdict, not a build failure");
  assert.equal(out.revealable, false, "and it must not go out under an email promising a website");
  assert.equal(out.reason, "content_floor:no_verified_content");
  assert.equal(out.checks.content_floor.status, "failed", "the named gate travels with the engine's own");
  assert.equal(out.content_floor.verdict, "no_verified_content");
});

// SERVICE FLOOR LOWERED TO ONE, 2026-08-13 (owner directive: build with what's
// real, don't hold a live business over a thin service list). The CONTENT floor
// is unchanged — one substance channel clears it. The service floor now clears
// on one real service too; the ONLY list it still holds is one made entirely of
// navigation junk (pinned by the two tests further below).
test("the same mirror WITH the client's own services is revealable again", async () => {
  const { deps } = floorDeps({ services: [{ name: "Drain cleaning" }, { name: "Water heater repair" }, { name: "Hydro jetting" }] });
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(out.revealable, true);
  assert.equal(out.reason, null);
  assert.equal(out.checks.content_floor.status, "passed");
  assert.equal(out.checks.service_floor.status, "passed");
});

test("one real service now clears BOTH floors (service floor lowered to one)", async () => {
  const { deps } = floorDeps({ services: [{ name: "Drain cleaning" }] });
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(out.ok, true, "the BUILD succeeded — this is a product verdict");
  assert.equal(out.checks.content_floor.status, "passed", "one channel clears the content floor, unchanged");
  assert.equal(out.checks.service_floor.status, "passed", "one real service now meets the floor of one");
  assert.equal(out.revealable, true);
  assert.equal(out.reason, null);
});

test("a service list that is entirely menu items is refused, and every casualty is named", async () => {
  // Rose City's real list, rendered from its live DOM on 2026-08-11, minus the
  // eight real HVAC services — which is what the page would have shipped if the
  // harvest had found nothing else.
  const { deps } = floorDeps({
    services: [{ name: "Photo Gallery" }, { name: "Comfort Club" }, { name: "Filter Club" }, { name: "Products" }],
  });
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(out.revealable, false);
  assert.equal(out.reason, "service_floor:all_refused");
  const floor = out.checks.service_floor;
  assert.equal(floor.supplied, 4);
  assert.equal(floor.publishable, 0);
  assert.deepEqual(floor.refused.map((r) => r.reason).sort(),
    ["membership_program", "membership_program", "navigation_label", "navigation_label"]);
  // The reason has to be readable by an operator who never opens this file.
  assert.match(floor.reason, /Photo Gallery=navigation_label/);
});

test("no service list at all is a refusal that says the description would stay the donor's", async () => {
  const { deps } = floorDeps({ reviews: [{ text: "Great crew.", author: "Jimmy B." }] });
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(out.checks.content_floor.status, "passed", "reviews alone still clear the content floor");
  assert.equal(out.checks.service_floor.verdict, "no_services_resolved");
  assert.equal(out.revealable, false);
  assert.match(out.checks.service_floor.reason, /donor's generic paragraph/);
});

test("MIRROR_SERVICE_FLOOR=0 turns the gate off without touching the measurement", async () => {
  const prev = process.env.MIRROR_SERVICE_FLOOR;
  process.env.MIRROR_SERVICE_FLOOR = "0";
  try {
    const { deps } = floorDeps({ services: [{ name: "Drain cleaning" }] });
    const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
    assert.equal(out.revealable, true);
    assert.equal(out.checks.service_floor.verdict, "floor_disabled");
    assert.equal(out.checks.service_floor.publishable, 1, "still measured, just not enforced");
  } finally {
    if (prev === undefined) delete process.env.MIRROR_SERVICE_FLOOR;
    else process.env.MIRROR_SERVICE_FLOOR = prev;
  }
});

test("the floor never overrides a truth gate — an unrevealable build stays unrevealable", async () => {
  const { deps } = floorDeps({ services: [{ name: "Drain cleaning" }] });
  const inner = deps.mirror;
  deps.mirror = async (req) => {
    const res = await inner(req);
    // The engine refused it on identity/brand/render. Content is beside the point.
    res.body.revealable = false;
    return res;
  };
  const out = await buildMirrorForProspect(PROSPECT, { deps, dryRun: true });
  assert.equal(out.revealable, false);
  assert.equal(out.checks.content_floor.status, "passed", "the floor reports honestly either way");
});
