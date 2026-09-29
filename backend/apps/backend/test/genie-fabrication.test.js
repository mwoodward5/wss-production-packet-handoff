"use strict";

// test/genie-fabrication.test.js — THE GENIE FABRICATES. This file is the proof
// and the lock.
//
// ---------------------------------------------------------------------------
// WHAT HAPPENED (captured live, 2026-07-31, and frozen in
// test/fixtures/genie-packet-jacksonville-roofing-usa.json — do NOT re-call the
// Genie to "confirm" it; the packet is the evidence and the call costs credits)
//
// We asked the SiteForge Intake Genie to compile jacksonvilleroofingusa.com.
// It returned:
//
//     facts.phone = "16872518405"
//     evidence[]  = { field: "phone", value: "16872518405",
//                     source_type: "operator_verified", confidence: 0.9 }
//
// That is not the business's phone number. The operator checked the business's
// own site: the real number is (904) 516-4279. The returned digits are the
// first 11 characters of the Facebook page id sitting in the SAME packet's
// facts.socials:
//
//     .../Jacksonville-Roofing-USA-LLC-168725184055402/
//                                      ^^^^^^^^^^^
//                                      16872518405
//
// So the Genie took an opaque identifier it had scraped, relabelled it a phone
// number, and stamped its own highest-trust badge on the result.
//
// ---------------------------------------------------------------------------
// THE LESSON THIS FILE EXISTS TO ENFORCE
//
//   A SOURCE ASSERTING ITS OWN TRUSTWORTHINESS IS NOT EVIDENCE.
//
// "operator_verified" is a string the Genie writes about itself. "0.9" is a
// number the Genie writes about itself. Neither is a second observation, so
// neither can corroborate anything. A packet that says it is trustworthy and a
// packet that fabricates are, from inside our process, the same packet — the
// only way to tell them apart is an INDEPENDENT observation of the same fact.
// Therefore no gate in this codebase may key off source_type or confidence,
// and no NAP value may enter a mirror on the Genie's say-so.
//
// The tests below assert the failure exactly as it occurred, show that our
// existing shape validators happily pass the fabricated number (shape validity
// is not truth), and then prove that the from-genie boundary REFUSES it rather
// than passing it through.
// ---------------------------------------------------------------------------

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  genieToMirrorRequest,
  packetToMirrorContent,
  packetToExtra,
  isNapKey,
  isTrustKey,
  genieContentEnabled,
  GENIE_CONTENT_FLAG,
  GENIE_CONTENT_QUARANTINE_REASON,
} = require("../lib/mirror-engine/from-genie");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { validateFacts } = require("../lib/mirror-engine/facts");
const { localBusinessJsonLd, reviewCta, normaliseFacts } = require("../lib/mirror-engine/local-seo");
const { buildJsonLd } = require("../lib/mirror-engine/content-inject");

const FIXTURE = path.resolve(__dirname, "fixtures/genie-packet-jacksonville-roofing-usa.json");
const LIVE_PACKET = require("./fixtures/genie-packet-jacksonville-roofing-usa.json");

/** The fabricated value, verbatim from the live packet. */
const FABRICATED_PHONE = "16872518405";

/**
 * The business's real number, observed by the operator on the business's own
 * site on 2026-07-31. It appears here ONLY as the thing the packet is not —
 * it is never written into a request by this file.
 */
const REAL_PHONE = "(904) 516-4279";

const digits = (s) => String(s || "").replace(/\D/g, "");

/** An independently observed NAP the caller supplies — never the Genie's. */
function operatorNap(over = {}) {
  return {
    phone: REAL_PHONE,
    website: "https://jacksonvilleroofingusa.com/",
    source: "operator:site-check-2026-07-31",
    ...over,
  };
}

// --- 1. THE FABRICATION, ASSERTED EXACTLY AS IT OCCURRED --------------------

test("FABRICATION: the packet's facts.phone is NOT the business's real phone", () => {
  assert.equal(LIVE_PACKET.facts.phone, FABRICATED_PHONE, "fixture must still hold the fabricated value");
  assert.notEqual(
    digits(LIVE_PACKET.facts.phone),
    digits(REAL_PHONE),
    "the Genie's phone must be recorded as WRONG — if this ever passes, the fixture was replaced, not the bug fixed",
  );
});

test("FABRICATION: the wrong number was carved out of the Facebook page id in the same packet", () => {
  // Provenance proved from inside the fixture alone — no external lookup.
  const fbId = digits(String(LIVE_PACKET.facts.socials[0]).match(/-(\d{6,})\/?$/)[1]);
  assert.ok(fbId.length > FABRICATED_PHONE.length, "the page id is longer than the phone it was cut from");
  assert.equal(
    fbId.slice(0, FABRICATED_PHONE.length),
    FABRICATED_PHONE,
    "the 'phone' is a prefix of the Facebook page id — an opaque identifier relabelled as contact info",
  );
});

test("FABRICATION: the packet stamps the fabricated value 'operator_verified' at 0.9 confidence", () => {
  const row = LIVE_PACKET.evidence.find((e) => e.field === "phone");
  assert.ok(row, "the packet does carry an evidence row for phone");
  assert.equal(row.value, FABRICATED_PHONE);
  assert.equal(row.source_type, "operator_verified");
  assert.ok(row.confidence >= 0.9, `confidence was ${row.confidence}`);
  // A SOURCE ASSERTING ITS OWN TRUSTWORTHINESS IS NOT EVIDENCE. This row is the
  // Genie describing the Genie. Read it as a claim, never as corroboration —
  // and note that the packet applies the same badge to `services`, which is the
  // scrape residue "Roofing \\" / the business's own name.
  const services = LIVE_PACKET.evidence.find((e) => e.field === "services");
  assert.equal(services.source_type, "operator_verified");
  assert.ok(services.value.includes(LIVE_PACKET.facts.name), "same badge, same self-assertion, visibly wrong payload");
});

test("SHAPE VALIDITY IS NOT TRUTH: our existing validators accept the fabricated number", () => {
  // This is why a downstream gate cannot save us. "16872518405" is a
  // well-formed 11-digit NANP-looking string, so derivePhoneDigits normalizes
  // it to a clean 10 digits and validateFacts returns ok. Every structural
  // check in the engine passes a number that would ring a stranger.
  const wouldBe = {
    slug: "wss-test-jacksonville-roofing-usa-genie",
    facts: {
      business_name: LIVE_PACKET.facts.name,
      industry: "Roofing",
      city: LIVE_PACKET.facts.city,
      state: LIVE_PACKET.facts.state,
      phone: FABRICATED_PHONE,
    },
  };
  assert.equal(checkMirrorRequest(wouldBe).ok, true, "schema does not catch it");
  const semantic = validateFacts(wouldBe);
  assert.equal(semantic.ok, true, "semantic validation does not catch it either");
  assert.equal(semantic.phoneDigits, "6872518405");
  // Hence the refusal has to happen at the SOURCE boundary, below.
});

// --- 2. OUR CODE REFUSES IT ------------------------------------------------

test("REFUSAL: the live fabricated packet cannot produce a mirror request on its own", () => {
  const r = genieToMirrorRequest(LIVE_PACKET, { slug: "wss-test-jacksonville-roofing-usa-genie" });
  assert.equal(r.ok, false, "a Genie packet alone must never yield a request");
  assert.equal(r.error, "nap_unverified");
  assert.equal(r.detail[0].path, "/facts/phone");
  assert.equal(r.detail[0].reason, "genie_nap_quarantined");
  assert.ok(r.detail[0].genie_supplied_nap.includes("phone"), "the blocker names what was dropped");
  assert.ok(!r.request, "no request object escapes the refusal");
  // The refusal must not carry the fabricated value anywhere in its payload.
  assert.ok(!JSON.stringify(r).includes(FABRICATED_PHONE), "the dropped value is not echoed back");
});

test("REFUSAL: the fabricated phone cannot reach a mirror even when the caller supplies verified NAP", () => {
  const r = genieToMirrorRequest(LIVE_PACKET, {
    slug: "wss-test-jacksonville-roofing-usa-genie",
    verifiedNap: operatorNap(),
    genieContent: true, // content pipe forced OPEN — NAP must still be gone
  });
  assert.equal(r.ok, true, JSON.stringify(r.detail || r.error));
  assert.equal(digits(r.request.facts.phone), digits(REAL_PHONE), "the verified number wins");
  assert.ok(
    !JSON.stringify(r.request).includes(FABRICATED_PHONE),
    "THE LOCK: the fabricated digits appear nowhere in the mirror request",
  );
  assert.ok(!JSON.stringify(r.request).includes("operator_verified"), "no self-asserted trust badge rides along");
  assert.equal(checkMirrorRequest(r.request).ok, true);
  assert.equal(validateFacts(r.request).phoneDigits, "9045164279");
  assert.deepEqual(r.genie_nap_dropped.sort(), ["phone", "website"], "both NAP fields the packet carried were dropped");
});

test("REFUSAL: the Genie may not be named as the independent source of its own NAP", () => {
  for (const source of ["intake-genie", "Genie packet", "siteforge GENIE compile"]) {
    const r = genieToMirrorRequest(LIVE_PACKET, {
      slug: "wss-test-jacksonville-roofing-usa-genie",
      verifiedNap: operatorNap({ source }),
    });
    assert.equal(r.ok, false, `"${source}" must not count as independent`);
    assert.equal(r.error, "nap_source_not_independent");
  }
  const noSource = genieToMirrorRequest(LIVE_PACKET, {
    slug: "wss-test-jacksonville-roofing-usa-genie",
    verifiedNap: { phone: REAL_PHONE },
  });
  assert.equal(noSource.error, "nap_source_required", "an unattributed NAP is not a verified NAP");
});

test("REFUSAL: NAP is dropped for EVERY packet, not just this one (no allowlist, no flag)", () => {
  const packet = {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    facts: {
      name: "Any Co", city: "Tucson", state: "AZ", category: "roofing",
      phone: "(555) 010-9999",
      email: "hello@wrong.example",
      address: "1 Wrong St",
      website: "https://wrong.example/",
      booking_url: "https://wrong.example/book",
    },
    assets: [], trust: {},
  };
  for (const genieContent of [false, true]) {
    const r = genieToMirrorRequest(packet, {
      slug: "wss-test-any-co",
      verifiedNap: { phone: "(520) 900-1442", source: "leadminer:row-1" },
      genieContent,
    });
    assert.equal(r.ok, true);
    assert.equal(r.request.facts.phone, "(520) 900-1442");
    assert.ok(!("email" in r.request.facts), "the packet's email is not adopted");
    assert.ok(!("address" in r.request.facts), "the packet's address is not adopted");
    assert.ok(!("current_website" in r.request.facts), "the packet's website is not adopted");
    const blob = JSON.stringify(r.request);
    for (const leaked of ["5550109999", "555) 010-9999", "hello@wrong.example", "1 Wrong St", "wrong.example"]) {
      assert.ok(!blob.includes(leaked), `${leaked} leaked into the request with genieContent=${genieContent}`);
    }
  }
});

test("REFUSAL: no NAP-shaped key can appear in mapped content or in extra", () => {
  const content = packetToMirrorContent(LIVE_PACKET);
  for (const k of Object.keys(content)) assert.ok(!isNapKey(k), `content.${k} is NAP-shaped`);
  const extra = packetToExtra(LIVE_PACKET);
  for (const k of Object.keys(extra)) assert.ok(!isNapKey(k), `extra.${k} is NAP-shaped`);
  // The forensic record survives as NAMES ONLY, never values.
  assert.ok(extra.dropped_nap.includes("phone"));
  assert.ok(extra.dropped_nap.includes("evidence:phone"));
  assert.ok(!(extra.evidence || []).some((e) => e.field === "phone"), "the self-asserted phone evidence row is gone");

  // The digits DO still occur once in `extra` — inside the Facebook URL they
  // were carved out of. That URL is real data and honest as a URL; it is only a
  // lie when something relabels a fragment of it as a phone number. So the
  // requirement is not "these digits must vanish", it is "these digits must
  // never stand alone as a contact fact".
  const values = [];
  (function walk(v) {
    if (typeof v === "string") values.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  })(extra);
  assert.ok(
    values.some((v) => v.includes(FABRICATED_PHONE) && v.startsWith("https://www.facebook.com/")),
    "the social URL is kept intact — it is the forensic trail",
  );
  assert.ok(
    !values.some((v) => digits(v) === FABRICATED_PHONE || digits(v) === digits(FABRICATED_PHONE).slice(1)),
    "no standalone phone-shaped value survives anywhere in extra",
  );
});

// --- 2B. THE TRUST NUMERALS — SAME CLASS, SAME BOUNDARY --------------------
//
// `trust.rating` and `trust.review_count` used to be copied straight onto
// request.facts because the Genie said so. That is the SAME unverified
// self-assertion as the phone above, and it is customer-visible three ways:
//
//   · tokens.js hydrates {{RATING}} / {{REVIEW_COUNT}} into the donor DOM;
//   · content-inject.js copies them into window.__WSS_CONTENT__.facts, and
//     donors-clean/concrete-elconstruction reads facts.rating + facts.review_count
//     back out and renders the stars itself;
//   · local-seo.js and content-inject.js attach both to JSON-LD
//     aggregateRating — a machine-readable claim made to Google.
//
// A phone the Genie invented misroutes one call. A rating the Genie invented is
// a fake review score on a live page and a manual-action risk on the listing.
// So the numerals are dropped at the SAME boundary, and may only re-enter via
// `verifiedReviews` from a source that is not the Genie.

/** A packet that asserts a rating the way the live one asserted a phone. */
function packetWithGenieRating(over = {}) {
  return {
    ok: true,
    version: "intake-genie-v2",
    status: "complete",
    facts: {
      name: "Any Co", city: "Tucson", state: "AZ", category: "roofing",
      phone: "(555) 010-9999",
    },
    assets: [],
    trust: {
      rating: 4.9,
      review_count: 412,
      reviews: [{ author: "Jane D.", text: "Great crew.", rating: 5 }],
    },
    evidence: [{ field: "rating", value: 4.9, source_type: "operator_verified", confidence: 0.9 }],
    ...over,
  };
}

const CALLER_NAP = { phone: "(520) 900-1442", source: "leadminer:row-1" };

test("TRUST: a Genie rating/review_count NEVER reaches a mirror request, both flag states", () => {
  for (const genieContent of [false, true]) {
    const r = genieToMirrorRequest(packetWithGenieRating(), {
      slug: "wss-test-any-co", verifiedNap: CALLER_NAP, genieContent,
    });
    assert.equal(r.ok, true, JSON.stringify(r.detail || r.error));
    assert.ok(!("rating" in r.request.facts), `rating adopted with genieContent=${genieContent}`);
    assert.ok(!("review_count" in r.request.facts), `review_count adopted with genieContent=${genieContent}`);
    // Not as a value anywhere in the request, either — {{RATING}} hydrates from
    // request.facts.rating, so a stray copy under any key is a rendered star.
    const blob = JSON.stringify(r.request);
    for (const leaked of ["4.9", "412"]) {
      assert.ok(!blob.includes(leaked), `${leaked} leaked into the request with genieContent=${genieContent}`);
    }
    // Names only in the audit trail — never the numbers.
    assert.deepEqual(r.genie_trust_dropped.sort(), ["rating", "review_count"]);
    assert.equal(r.reviews_source, null, "no source, because nothing was verified");
  }
});

test("TRUST: the live fabricating packet cannot ship stars either", () => {
  // Same packet that fabricated the phone, now also asserting a rating.
  const packet = { ...LIVE_PACKET, trust: { ...LIVE_PACKET.trust, rating: 5, review_count: 88 } };
  const r = genieToMirrorRequest(packet, {
    slug: "wss-test-jacksonville-roofing-usa-genie",
    verifiedNap: operatorNap(),
    genieContent: true,
  });
  assert.equal(r.ok, true, JSON.stringify(r.detail || r.error));
  assert.ok(!("rating" in r.request.facts));
  assert.ok(!("review_count" in r.request.facts));
  assert.ok(!JSON.stringify(r.request).includes("88"), "the asserted review count is nowhere in the request");
  assert.ok(!JSON.stringify(r.request).includes(FABRICATED_PHONE), "and the phone is still gone");
});

test("TRUST: verified reviews from an INDEPENDENT source are the only way in", () => {
  const r = genieToMirrorRequest(packetWithGenieRating(), {
    slug: "wss-test-any-co",
    verifiedNap: CALLER_NAP,
    verifiedReviews: { rating: 4.6, review_count: 137, source: "brightdata:gbp-2026-07-31" },
  });
  assert.equal(r.ok, true, JSON.stringify(r.detail || r.error));
  assert.equal(r.request.facts.rating, 4.6, "the independently observed rating wins");
  assert.equal(r.request.facts.review_count, 137);
  assert.equal(r.reviews_source, "brightdata:gbp-2026-07-31");
  // The Genie's competing numbers are still gone — not kept as a "confirmation".
  const blob = JSON.stringify(r.request);
  assert.ok(!blob.includes("4.9") && !blob.includes("412"), "the packet's own numerals do not ride along");
  assert.equal(checkMirrorRequest(r.request).ok, true);
});

test("TRUST: the Genie may not be named as the independent source of its own rating", () => {
  for (const source of ["intake-genie", "Genie packet", "siteforge GENIE compile"]) {
    const r = genieToMirrorRequest(packetWithGenieRating(), {
      slug: "wss-test-any-co",
      verifiedNap: CALLER_NAP,
      verifiedReviews: { rating: 4.9, review_count: 412, source },
    });
    assert.equal(r.ok, false, `"${source}" must not count as independent`);
    assert.equal(r.error, "reviews_source_not_independent");
  }
  const noSource = genieToMirrorRequest(packetWithGenieRating(), {
    slug: "wss-test-any-co",
    verifiedNap: CALLER_NAP,
    verifiedReviews: { rating: 4.9, review_count: 412 },
  });
  assert.equal(noSource.error, "reviews_source_required", "an unattributed rating is not a verified rating");
});

test("TRUST: half a rating is refused — both numerals or neither", () => {
  const cases = [
    { rating: 4.6 },                        // a score with nothing behind it
    { review_count: 137 },                  // a count with no score
    { rating: 0, review_count: 137 },       // zero is not a rating
    { rating: 4.6, review_count: 0 },       // zero reviews cannot average to 4.6
    { rating: 9.9, review_count: 137 },     // off a 5-star scale
    { rating: "n/a", review_count: "many" },
  ];
  for (const c of cases) {
    const r = genieToMirrorRequest(packetWithGenieRating(), {
      slug: "wss-test-any-co",
      verifiedNap: CALLER_NAP,
      verifiedReviews: { ...c, source: "brightdata:gbp-2026-07-31" },
    });
    assert.equal(r.ok, false, `${JSON.stringify(c)} must be refused`);
    assert.equal(r.error, "reviews_incomplete");
    assert.ok(!r.request, "no request escapes a half-verified rating");
  }
});

test("TRUST: a per-review star number is dropped; the words survive the flag", () => {
  const packet = packetWithGenieRating();
  const content = packetToMirrorContent(packet);
  assert.deepEqual(content.reviews, [{ text: "Great crew.", author: "Jane D." }],
    "review text and author survive; the Genie's star number does not");
  for (const k of Object.keys(content)) assert.ok(!isTrustKey(k), `content.${k} is a trust numeral`);

  // And with the content pipe wide open it is still absent from the request —
  // content.reviews is copied verbatim into window.__WSS_CONTENT__.reviews.
  const r = genieToMirrorRequest(packet, {
    slug: "wss-test-any-co", verifiedNap: CALLER_NAP, genieContent: true,
  });
  assert.ok(r.request.content.reviews.every((x) => !("rating" in x)), "no star number in the data island");
});

test("TRUST: dropped numerals are recorded by KEY NAME only, never by value", () => {
  const extra = packetToExtra(packetWithGenieRating());
  assert.ok(extra.dropped_trust.includes("rating"));
  assert.ok(extra.dropped_trust.includes("review_count"));
  assert.ok(extra.dropped_trust.includes("reviews[].rating"));
  for (const k of Object.keys(extra)) assert.ok(!isTrustKey(k), `extra.${k} is a trust numeral`);
  // The self-asserted evidence row for the rating is gone value-and-all, exactly
  // like the phone's. "operator_verified" on a number the Genie chose is the
  // same non-evidence it was on the phone.
  assert.ok(!(extra.evidence || []).some((e) => e.field === "rating"));
  assert.ok(extra.dropped_trust.includes("evidence:rating"));
  assert.ok(!JSON.stringify(extra).includes("4.9"), "the number itself is not echoed back anywhere");
});

test("TRUST: aliases are covered, and non-trust keys are not swallowed", () => {
  for (const k of [
    "rating", "Rating", "star_rating", "avg_rating", "average_rating",
    "google_rating", "ratingValue", "review_count", "reviewCount",
    "user_ratings_total", "total_reviews", "num_reviews", "ratings_total",
  ]) assert.ok(isTrustKey(k), `${k} must be quarantined`);
  for (const k of ["reviews", "name", "city", "services", "about", "areas", "hours"]) {
    assert.ok(!isTrustKey(k), `${k} must NOT be swallowed by the trust filter`);
  }
  // An aliased numeral on facts is dropped too, wherever the packet put it.
  const r = genieToMirrorRequest(packetWithGenieRating({
    facts: {
      name: "Any Co", city: "Tucson", state: "AZ", category: "roofing",
      google_rating: 4.7, user_ratings_total: 300,
    },
    trust: {},
  }), { slug: "wss-test-any-co", verifiedNap: CALLER_NAP });
  assert.equal(r.ok, true, JSON.stringify(r.detail || r.error));
  assert.ok(!("rating" in r.request.facts));
  assert.ok(!JSON.stringify(r.request).includes("4.7"));
  assert.deepEqual(r.genie_trust_dropped.sort(), ["google_rating", "user_ratings_total"]);
});

// --- 2C. DOWNSTREAM: NO NUMERALS, NO aggregateRating ------------------------

test("DOWNSTREAM: with no verified reviews, nothing renders stars or aggregateRating", () => {
  const r = genieToMirrorRequest(packetWithGenieRating(), {
    slug: "wss-test-any-co", verifiedNap: CALLER_NAP, genieContent: true,
  });
  assert.equal(r.ok, true);
  // place_id is present so the review CTA itself renders — proving the stars are
  // absent because the numbers are absent, not because the block never ran.
  const facts = { ...r.request.facts, place_id: "ChIJtest", site_url: "https://wss-test-any-co.wss-ai.com/" };

  const seo = normaliseFacts(facts);
  assert.equal(seo.rating, null);
  assert.equal(seo.reviewCount, null);

  const ld = localBusinessJsonLd(facts);
  assert.ok(ld.includes("LocalBusiness"), "the entity still renders");
  assert.ok(!ld.includes("aggregateRating"), "but it makes no rating claim to Google");

  const cta = reviewCta(facts);
  assert.ok(cta.includes("Leave us a Google review"), "the compliant CTA still renders");
  assert.ok(!cta.includes("trust-rating"), "no star figure");
  assert.ok(!cta.includes("trust-count"), "no review count");
  assert.ok(!cta.includes("4.9") && !cta.includes("412"), "and certainly not the Genie's numbers");

  // The other JSON-LD writer, on the same facts.
  const graph = buildJsonLd({
    content: r.request.content || {}, facts, phoneDigits: "5209001442",
    siteUrl: "https://wss-test-any-co.wss-ai.com/", logoUrl: "",
  });
  assert.ok(!JSON.stringify(graph).includes("aggregateRating"), "content-inject emits none either");
});

test("DOWNSTREAM: a VERIFIED rating does still render — the gate blocks lies, not stars", () => {
  const r = genieToMirrorRequest(packetWithGenieRating(), {
    slug: "wss-test-any-co",
    verifiedNap: CALLER_NAP,
    verifiedReviews: { rating: 4.6, review_count: 137, source: "brightdata:gbp-2026-07-31" },
  });
  const facts = { ...r.request.facts, place_id: "ChIJtest" };
  const ld = JSON.parse(localBusinessJsonLd(facts).replace(/^[^{]*/, "").replace(/<\/script>$/, ""));
  assert.equal(ld.aggregateRating.ratingValue, 4.6);
  assert.equal(ld.aggregateRating.reviewCount, 137);
  const cta = reviewCta(facts);
  assert.ok(cta.includes("4.6★"));
  assert.ok(cta.includes("137 Google reviews"));
});

// --- 3. THE CONTENT QUARANTINE ---------------------------------------------

test("QUARANTINE: Genie content is OFF by default and says why", () => {
  const prior = process.env[GENIE_CONTENT_FLAG];
  delete process.env[GENIE_CONTENT_FLAG];
  try {
    assert.equal(genieContentEnabled(), false, "unset flag means quarantined");
    const r = genieToMirrorRequest(LIVE_PACKET, {
      slug: "wss-test-jacksonville-roofing-usa-genie",
      verifiedNap: operatorNap(),
      truthSource: FIXTURE,
    });
    assert.equal(r.ok, true);
    assert.equal(r.content, null, "content is NULL when quarantined, not silently emptied");
    assert.equal(r.content_quarantine.quarantined, true);
    assert.equal(r.content_quarantine.reason, GENIE_CONTENT_QUARANTINE_REASON);
    assert.equal(r.content_quarantine.flag, "GENIE_CONTENT_ENABLED");
    assert.match(r.content_quarantine.detail, /independent NAP cross-check/);
    assert.ok(r.content_quarantine.withheld.includes("services"), "it states what it is holding back");
    assert.ok(!("content" in r.request), "nothing is attached to the request");
    // The build still runs — on verified facts only.
    assert.equal(checkMirrorRequest(r.request).ok, true);
    assert.equal(r.request.facts.business_name, "Jacksonville Roofing USA");
  } finally {
    if (prior === undefined) delete process.env[GENIE_CONTENT_FLAG];
    else process.env[GENIE_CONTENT_FLAG] = prior;
  }
});

test("QUARANTINE: a blank/typo'd/negative flag value fails CLOSED", () => {
  const prior = process.env[GENIE_CONTENT_FLAG];
  try {
    for (const v of ["", " ", "0", "off", "false", "no", "yes please", "TRUEish"]) {
      process.env[GENIE_CONTENT_FLAG] = v;
      assert.equal(genieContentEnabled(), false, `"${v}" must not open the pipe`);
      const r = genieToMirrorRequest(LIVE_PACKET, {
        slug: "wss-test-jacksonville-roofing-usa-genie",
        verifiedNap: operatorNap(),
      });
      assert.equal(r.content, null);
      assert.ok(!("content" in r.request));
    }
  } finally {
    if (prior === undefined) delete process.env[GENIE_CONTENT_FLAG];
    else process.env[GENIE_CONTENT_FLAG] = prior;
  }
});

test("QUARANTINE: an explicit opt-in re-opens descriptive content only", () => {
  const prior = process.env[GENIE_CONTENT_FLAG];
  try {
    for (const v of ["1", "true", "on", "ON"]) {
      process.env[GENIE_CONTENT_FLAG] = v;
      assert.equal(genieContentEnabled(), true, `"${v}" is an explicit opt-in`);
    }
    const r = genieToMirrorRequest(LIVE_PACKET, {
      slug: "wss-test-jacksonville-roofing-usa-genie",
      verifiedNap: operatorNap(),
      truthSource: FIXTURE,
    });
    assert.equal(r.ok, true);
    assert.equal(r.content_quarantine, null);
    assert.ok(r.request.content, "content is attached when the operator opts in");
    assert.ok(r.request.content.services.length > 0, "services is the descriptive class the cross-check will unlock");
    assert.deepEqual(r.request.content.truth_source, [FIXTURE]);
    for (const k of Object.keys(r.request.content)) assert.ok(!isNapKey(k), `content.${k} is NAP-shaped`);
    assert.equal(checkMirrorRequest(r.request).ok, true);
    // Even wide open, the fabricated number is still nowhere.
    assert.ok(!JSON.stringify(r.request).includes(FABRICATED_PHONE));
  } finally {
    if (prior === undefined) delete process.env[GENIE_CONTENT_FLAG];
    else process.env[GENIE_CONTENT_FLAG] = prior;
  }
});

test("QUARANTINE: the explicit genieContent option overrides the env flag in both directions", () => {
  const prior = process.env[GENIE_CONTENT_FLAG];
  try {
    process.env[GENIE_CONTENT_FLAG] = "1";
    const forcedOff = genieToMirrorRequest(LIVE_PACKET, {
      slug: "wss-test-jacksonville-roofing-usa-genie",
      verifiedNap: operatorNap(),
      genieContent: false,
    });
    assert.equal(forcedOff.content, null);
    assert.equal(forcedOff.content_quarantine.reason, GENIE_CONTENT_QUARANTINE_REASON);

    delete process.env[GENIE_CONTENT_FLAG];
    const forcedOn = genieToMirrorRequest(LIVE_PACKET, {
      slug: "wss-test-jacksonville-roofing-usa-genie",
      verifiedNap: operatorNap(),
      genieContent: true,
    });
    assert.ok(forcedOn.request.content);
  } finally {
    if (prior === undefined) delete process.env[GENIE_CONTENT_FLAG];
    else process.env[GENIE_CONTENT_FLAG] = prior;
  }
});
