import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const googleHandler = require(join(repoRoot, "api", "google-places-intake.js"));
const AUTH_TOKEN = "google-places-auth-token";
const ENV_KEYS = ["INTAKE_GENIE_TOKEN", "GOOGLE_PLACES_API_KEY", "GOOGLE_MAPS_API_KEY", "MAPS_API_KEY"];
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "location",
  "regularOpeningHours",
  "types",
  "rating",
  "userRatingCount",
  "businessStatus",
  "addressComponents"
].join(",");

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function captureResponse() {
  let resolve;
  const complete = new Promise(done => { resolve = done; });
  const response = {
    statusCode: 200,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { resolve({ status: this.statusCode, body }); return this; },
    end(body = "") { resolve({ status: this.statusCode, body }); return this; }
  };
  return { response, complete };
}

async function invoke(body) {
  const { response, complete } = captureResponse();
  await googleHandler({
    method: "POST",
    headers: {
      origin: "https://pagehub-intake-lock-form.vercel.app",
      authorization: `Bearer ${AUTH_TOKEN}`
    },
    body
  }, response);
  return complete;
}

async function withGoogleEnvironment(values, fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  const originalValues = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  ENV_KEYS.forEach(key => { delete process.env[key]; });
  process.env.INTAKE_GENIE_TOKEN = AUTH_TOKEN;
  Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
    ENV_KEYS.forEach(key => {
      if (originalValues[key] === undefined) delete process.env[key];
      else process.env[key] = originalValues[key];
    });
  }
}

function newPlaceFixture() {
  return {
    id: "ChIJNEWFIXTURE",
    displayName: { text: "Bill Smith Plumbing", languageCode: "en" },
    formattedAddress: "100 Water Way, Test City, TX 75000, USA",
    nationalPhoneNumber: "(555) 222-3333",
    internationalPhoneNumber: "+1 555-222-3333",
    websiteUri: "https://billsmith-plumbing.com/",
    googleMapsUri: "https://maps.google.com/?cid=123",
    location: { latitude: 32.12345, longitude: -96.54321 },
    regularOpeningHours: { weekdayDescriptions: ["Monday: 8:00 AM-5:00 PM", "Tuesday: 8:00 AM-5:00 PM"] },
    types: ["plumber"],
    rating: 4.8,
    userRatingCount: 87,
    businessStatus: "OPERATIONAL",
    addressComponents: [
      { longText: "Test City", shortText: "Test City", types: ["locality"] },
      { longText: "Texas", shortText: "TX", types: ["administrative_area_level_1"] },
      { longText: "75000", shortText: "75000", types: ["postal_code"] },
      { longText: "United States", shortText: "US", types: ["country"] }
    ]
  };
}

test("Places API New search and details map into the existing intake fields", { concurrency: false }, async () => {
  const calls = [];
  const result = await withGoogleEnvironment({ GOOGLE_PLACES_API_KEY: "new-api-fixture-key" }, async (input, options = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(options.headers || {});
    calls.push({ url: url.href, method: options.method || "GET" });
    assert.equal(url.origin, "https://places.googleapis.com");
    assert.ok(!url.searchParams.has("key"), "API keys must not be placed in URLs");
    assert.equal(headers.get("x-goog-api-key"), "new-api-fixture-key");

    if (url.pathname === "/v1/places:searchText") {
      assert.equal(options.method, "POST");
      assert.equal(headers.get("content-type"), "application/json");
      assert.equal(headers.get("x-goog-fieldmask"), "places.id");
      assert.deepEqual(JSON.parse(options.body), {
        textQuery: "Bill Smith Plumbing Test City TX",
        languageCode: "en",
        regionCode: "US",
        pageSize: 1,
        includePureServiceAreaBusinesses: true
      });
      return jsonResponse({ places: [{ id: "ChIJNEWFIXTURE" }] });
    }
    if (url.pathname === "/v1/places/ChIJNEWFIXTURE") {
      assert.equal(options.method, "GET");
      assert.equal(headers.get("x-goog-fieldmask"), DETAILS_FIELD_MASK);
      return jsonResponse(newPlaceFixture());
    }
    throw new Error(`Unexpected or legacy Google endpoint: ${url.origin}${url.pathname}`);
  }, () => invoke({ query: "Bill Smith Plumbing Test City TX" }));

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.status, "mapped");
  assert.equal(result.body.fields.businessName, "Bill Smith Plumbing");
  assert.equal(result.body.fields.phone, "(555) 222-3333");
  assert.equal(result.body.fields.domainUrl, "https://billsmith-plumbing.com/");
  assert.equal(result.body.fields.gbpLink, "https://maps.google.com/?cid=123");
  assert.equal(result.body.fields.gbpPlaceId, "ChIJNEWFIXTURE");
  assert.equal(result.body.fields.address, "100 Water Way, Test City, TX 75000, USA");
  assert.equal(result.body.fields.geoLat, "32.12345");
  assert.equal(result.body.fields.geoLng, "-96.54321");
  assert.equal(result.body.fields.serviceRadiusMiles, 25);
  assert.equal(result.body.fields.serviceRadiusNeedsReview, true);
  assert.equal(result.body.fields.hours, "Monday: 8:00 AM-5:00 PM\nTuesday: 8:00 AM-5:00 PM");
  assert.equal(result.body.fields.hoursSource, "Google Business Profile");
  assert.equal(result.body.fields.listingConfidence, "Exact business match");
  assert.equal(result.body.fields.serviceArea, "Test City, TX");
  assert.match(result.body.fields.reviewsProof, /4\.8.*87/);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => !/maps\.googleapis\.com|\/maps\/api\/place\//i.test(call.url)));
});

test("permission failure advances to the next configured key without using legacy endpoints", { concurrency: false }, async () => {
  const calls = [];
  const result = await withGoogleEnvironment({
    GOOGLE_PLACES_API_KEY: "denied-fixture-key",
    GOOGLE_MAPS_API_KEY: "working-fixture-key"
  }, async (input, options = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(options.headers || {});
    calls.push({ url: url.href, key: headers.get("x-goog-api-key") });
    if (url.origin !== "https://places.googleapis.com") throw new Error(`Legacy endpoint called: ${url.href}`);
    if (headers.get("x-goog-api-key") === "denied-fixture-key") {
      return jsonResponse({ error: { code: 403, status: "PERMISSION_DENIED", message: "API key not valid" } }, 403);
    }
    if (url.pathname === "/v1/places:searchText") return jsonResponse({ places: [{ id: "ChIJNEWFIXTURE" }] });
    if (url.pathname === "/v1/places/ChIJNEWFIXTURE") return jsonResponse(newPlaceFixture());
    throw new Error(`Unexpected endpoint: ${url.href}`);
  }, () => invoke({ query: "Bill Smith Plumbing Test City TX" }));

  assert.equal(result.status, 200);
  assert.equal(result.body.status, "mapped");
  assert.deepEqual(calls.map(call => call.key), ["denied-fixture-key", "working-fixture-key", "working-fixture-key"]);
  assert.ok(calls.every(call => !/maps\.googleapis\.com|\/maps\/api\/place\//i.test(call.url)));
});

test("OpenStreetMap address fallback remains available after Places API New rejects all keys", { concurrency: false }, async () => {
  const calls = [];
  const result = await withGoogleEnvironment({ GOOGLE_PLACES_API_KEY: "denied-fixture-key" }, async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push(url.href);
    if (url.origin === "https://places.googleapis.com") {
      return jsonResponse({ error: { code: 403, status: "PERMISSION_DENIED", message: "API key not valid" } }, 403);
    }
    if (url.origin === "https://nominatim.openstreetmap.org") {
      return jsonResponse([{
        lat: "32.5001",
        lon: "-96.5002",
        display_name: "100 Water Way, Test City, Texas, United States",
        address: { city: "Test City", state: "Texas" }
      }]);
    }
    throw new Error(`Unexpected or legacy endpoint: ${url.href}`);
  }, () => invoke({
    query: "Bill Smith Plumbing Test City TX",
    address: "100 Water Way, Test City, TX 75000",
    businessName: "Bill Smith Plumbing",
    websiteUrl: "https://billsmith-plumbing.com/"
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.status, "mapped_fallback");
  assert.equal(result.body.fields.geoLat, "32.5001");
  assert.equal(result.body.fields.geoLng, "-96.5002");
  assert.equal(result.body.fields.serviceRadiusNeedsReview, true);
  assert.ok(calls.some(url => /nominatim\.openstreetmap\.org/.test(url)));
  assert.ok(calls.every(url => !/maps\.googleapis\.com|\/maps\/api\/place\//i.test(url)));
});
