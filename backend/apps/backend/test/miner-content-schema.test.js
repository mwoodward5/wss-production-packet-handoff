"use strict";

/**
 * test/miner-content-schema.test.js — the miner's content must be shaped in
 * the schema's own vocabulary.
 *
 * WHAT THIS PINS DOWN. MirrorContent.reviews is additionalProperties:false and
 * declares {text, author?, rating?, avatarUrl?, publishedAt?}. The miner reads
 * Google Places and carries the STORE's field names (author_photo_url,
 * published_at). Putting that raw shape into content.reviews hard-400s the
 * stage-8 dry run with
 *     /content/reviews/0 · additionalProperties · must NOT have additional
 * and because Google returns publishTime on EVERY review, that rejected every
 * lead that had any reviews at all. Measured on production 2026-08-06:
 * Nashville 3/3, Memphis 4/4 and Indianapolis 5/7 of all stage-8 entrants
 * lost to this single error — so the only businesses the machine could build
 * were the ones with no reviews, the exact inverse of a lead worth having.
 *
 * These tests do not assert on a passing gate; they assert on the VALIDATOR
 * that produced the production 400, using a verbatim Places (New) review shape.
 */
const test = require("node:test");
const assert = require("node:assert");

const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { shapeReviews } = require("../lib/mirror-engine/verified-facts");

// The store's/miner's spelling — what reviewsFromPlace() emits.
const MINER_SHAPE = Object.freeze([
  {
    text: "Fast, fair and clean. Fixed our water heater the same day.",
    author: "Dana W.",
    rating: 5,
    author_photo_url: "https://lh3.googleusercontent.com/a-/ALV-UjXreal=s128-c-rp-mo",
    published_at: "2026-05-02T18:11:04Z",
  },
  {
    text: "Showed up on a Sunday for a burst pipe. Would call again.",
    author: "Marcus T.",
    rating: 5,
    published_at: "2026-04-11T14:02:00Z",
  },
]);

function requestWith(reviews) {
  return {
    slug: "wss-test-demo-plumbing-indianapolis",
    donor: "plumbing-clean",
    facts: {
      business_name: "Demo Plumbing",
      industry: "plumbing",
      phone: "(317) 555-0123",
      city: "Indianapolis",
      state: "IN",
    },
    brand: {
      logo: "https://demoplumbing.example/logo.png",
      logo_sha256: "a".repeat(64),
      accent: "#C53F34",
      accent_source: "https://demoplumbing.example/logo.png",
    },
    content: { reviews },
  };
}

function reviewErrors(result) {
  if (result.ok) return [];
  return (result.body.detail || []).filter((d) => String(d.path).startsWith("/content/reviews"));
}

test("the miner's raw review spelling is what the schema rejected — this is the production 400", () => {
  const result = checkMirrorRequest(requestWith(MINER_SHAPE));
  assert.equal(result.ok, false);
  const errors = reviewErrors(result);
  assert.ok(errors.length > 0, "expected /content/reviews additionalProperties errors");
  assert.ok(
    errors.every((e) => e.keyword === "additionalProperties"),
    "every review error is the additional-properties rejection",
  );
  // The SECOND review has no photo at all and still fails — published_at alone
  // is enough. That is why the kill rate was total rather than partial.
  assert.ok(errors.some((e) => e.path === "/content/reviews/1"));
});

test("shapeReviews translates that same corpus into a request the validator accepts", () => {
  const result = checkMirrorRequest(requestWith(shapeReviews(MINER_SHAPE)));
  assert.equal(result.ok, true, `expected a valid request, got ${JSON.stringify(result.body && result.body.detail)}`);
});

test("translation loses no verified fact — the words, the name, the rating, the face and the date all survive", () => {
  const shaped = shapeReviews(MINER_SHAPE);
  assert.equal(shaped.length, 2);
  assert.equal(shaped[0].text, MINER_SHAPE[0].text);
  assert.equal(shaped[0].author, "Dana W.");
  assert.equal(shaped[0].rating, 5);
  assert.equal(shaped[0].avatarUrl, MINER_SHAPE[0].author_photo_url);
  assert.equal(shaped[0].publishedAt, MINER_SHAPE[0].published_at);
  // Nothing is invented for the reviewer who has no photo: the key is ABSENT.
  assert.equal(Object.prototype.hasOwnProperty.call(shaped[1], "avatarUrl"), false);
});

test("a Google initial-tile is not a face, and is never smuggled through as one", () => {
  const shaped = shapeReviews([{
    text: "Great crew.",
    author: "R. Patel",
    // Google's generated monogram tile, not a photograph the reviewer supplied.
    author_photo_url: "https://lh3.googleusercontent.com/a/ACg8ocInitialTileOnly=s128",
  }]);
  assert.equal(Object.prototype.hasOwnProperty.call(shaped[0], "avatarUrl"), false);
  assert.equal(checkMirrorRequest(requestWith(shaped)).ok, true);
});
