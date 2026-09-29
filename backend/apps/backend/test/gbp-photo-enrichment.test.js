"use strict";
// test/gbp-photo-enrichment.test.js
//
// Acceptance tests for the GBP photo-bank enrichment step (issue #314).
//
// AC1 — a prospect with place_id + 0 site-harvested photos gets >=1 GBP photo
//        in the bank after enrichment.
// AC2 — stock-looking GBP URLs are still rejected (client-photos rules apply).
// AC3 — no Places API call is made when place_id is absent (fail soft).
// AC4 — enrichment works end-to-end with a mocked Places media response.

const test = require("node:test");
const assert = require("node:assert/strict");

const { enrichGbpPhotos } = require("../lib/client-photo-bank");

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makeResolveMedia(urlByName) {
  return async (resourceName) => urlByName[resourceName] ?? null;
}

function makeHarvest(photosByKey) {
  return async ({ html }) => {
    const key = html && html.includes("gbp only") ? "gbp" : null;
    const photos = (key && photosByKey[key]) || [];
    return { ok: true, photos, rejected: [] };
  };
}

// ---------------------------------------------------------------------------
// AC1: place_id + 0 site photos → >=1 GBP photo in bank
// ---------------------------------------------------------------------------

test("AC1: a prospect with place_id and a GBP resource name gets at least one banked GBP photo", async () => {
  const resolvedUrl = "https://lh3.googleusercontent.com/place-photos/Fairway-work-1";
  const record = {
    place_id: "ChIJfairway",
    gbp_url: "https://www.google.com/maps/place/?q=place_id:ChIJfairway",
    photos: ["places/ChIJfairway/photos/AeJwork1"],
  };

  const bank = await enrichGbpPhotos(record, {
    placesApiKey: "TEST_KEY",
    resolveMedia: makeResolveMedia({ "places/ChIJfairway/photos/AeJwork1": resolvedUrl }),
    harvest: makeHarvest({
      gbp: [{
        url: resolvedUrl,
        source: "gbp",
        sha256: "a".repeat(64),
        bytes: 310000,
        width: 1600,
        height: 900,
        ext: "jpg",
      }],
    }),
  });

  assert.ok(bank, "enrichGbpPhotos must return a bank object");
  assert.ok(bank.photos.length >= 1, "bank must contain at least one GBP photo");
  assert.equal(bank.photos[0].source, "gbp");
  assert.equal(bank.photos[0].url, resolvedUrl);
  assert.equal(bank.photos[0].place_id, "ChIJfairway");
  assert.equal(bank.counts.gbp, bank.photos.length);
  assert.equal(bank.verdict, "photography");
});

// ---------------------------------------------------------------------------
// AC2: stock-looking GBP URLs are rejected (client-photos rules still apply)
// ---------------------------------------------------------------------------

test("AC2: a banner-shaped GBP photo is refused even though it came from the Places API", async () => {
  const bannerUrl = "https://lh3.googleusercontent.com/place-photos/Fairway-banner";
  const record = {
    place_id: "ChIJfairway",
    gbp_url: "https://www.google.com/maps/place/?q=place_id:ChIJfairway",
    photos: ["places/ChIJfairway/photos/AeJbanner"],
  };

  const bank = await enrichGbpPhotos(record, {
    placesApiKey: "TEST_KEY",
    resolveMedia: makeResolveMedia({ "places/ChIJfairway/photos/AeJbanner": bannerUrl }),
    harvest: makeHarvest({
      // Harvester returns the resolved URL with banner dimensions (wide strip).
      gbp: [{
        url: bannerUrl,
        source: "gbp",
        sha256: "b".repeat(64),
        bytes: 50000,
        width: 1200,
        height: 90,
        ext: "png",
      }],
    }),
  });

  assert.ok(bank, "bank object must be returned even when all candidates are refused");
  assert.equal(bank.photos.length, 0, "the banner-shaped photo must not reach the bank");
  assert.ok(
    bank.refused.some((r) => r.url === bannerUrl && r.reason === "banner_shape"),
    `expected banner_shape refusal, got: ${JSON.stringify(bank.refused)}`,
  );
});

// ---------------------------------------------------------------------------
// AC3: no API call when place_id is absent
// ---------------------------------------------------------------------------

test("AC3: enrichGbpPhotos returns null immediately when the record has no place_id", async () => {
  let apiCallsMade = 0;
  const trackingResolve = async () => { apiCallsMade++; return null; };

  const result = await enrichGbpPhotos(
    { photos: ["places/ChIJorphan/photos/AeJxyz"] }, // resource name but no place_id
    { placesApiKey: "TEST_KEY", resolveMedia: trackingResolve },
  );

  assert.equal(result, null, "must return null, not a bank, when place_id is missing");
  assert.equal(apiCallsMade, 0, "must not make any Places API call when place_id is absent");
});

test("AC3: enrichGbpPhotos returns null for a fully empty record", async () => {
  const result = await enrichGbpPhotos({}, { placesApiKey: "TEST_KEY" });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// AC4: end-to-end with a mocked Places photo-media response
// ---------------------------------------------------------------------------

test("AC4: mocked Places response — resource name resolves through media endpoint into a pinned bank row", async () => {
  const photoUri = "https://lh3.googleusercontent.com/place-photos/mocked-media-uri=w1600";
  let capturedMediaRequest = "";

  // The real resolvePlaceMediaUrl calls
  //   GET /v1/{resourceName}/media?key=...&maxWidthPx=...&skipHttpRedirect=true
  // and reads response.photoUri.  Here we stub the whole Places fetch.
  const mockFetchImpl = async (url) => {
    capturedMediaRequest = url;
    return {
      ok: true,
      json: async () => ({ photoUri }),
    };
  };

  const record = {
    place_id: "ChIJmocked",
    gbp_url: "https://www.google.com/maps/place/?q=place_id:ChIJmocked",
    photos: ["places/ChIJmocked/photos/AeJmocked"],
  };

  const bank = await enrichGbpPhotos(record, {
    placesApiKey: "MOCK_KEY",
    fetchImpl: mockFetchImpl,
    harvest: makeHarvest({
      gbp: [{
        url: photoUri,
        source: "gbp",
        sha256: "c".repeat(64),
        bytes: 420000,
        width: 1600,
        height: 900,
        ext: "jpg",
      }],
    }),
  });

  // The Places media endpoint must have been called with the resource name and key.
  assert.match(capturedMediaRequest, /places\/ChIJmocked\/photos\/AeJmocked/, "media URL must contain the resource name");
  assert.match(capturedMediaRequest, /MOCK_KEY/, "media URL must include the API key");
  assert.match(capturedMediaRequest, /skipHttpRedirect=true/, "must request JSON, not a redirect");

  assert.ok(bank, "bank must be returned");
  assert.equal(bank.photos.length, 1, "exactly one photo must land in the bank");
  assert.equal(bank.photos[0].url, photoUri);
  assert.equal(bank.photos[0].source, "gbp");
  assert.equal(bank.photos[0].place_id, "ChIJmocked");
  assert.equal(bank.photos[0].resource_name, "places/ChIJmocked/photos/AeJmocked");
  assert.equal(bank.cost.gbp_media_calls, 1);
  assert.equal(bank.verdict, "photography");
});
