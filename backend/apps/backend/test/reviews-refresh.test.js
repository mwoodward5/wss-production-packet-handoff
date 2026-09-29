"use strict";

// THE LIVE REVIEW SYNC — the cost-law tests.
//
// This team was burned ~$1,000 by Google Places image calls. lib/reviews-refresh.js
// exists to sync fresh Google reviews WITHOUT ever being able to spend like
// that again, and these tests pin every law that matters:
//
//   LAW 1 — the Places call is a GET places/{id} with `X-Goog-FieldMask:
//   reviews` and NOTHING else (no photos, no details — pinned byte-for-byte).
//   LAW 2 — max N Places calls per run; EVERY call (success, empty, failed)
//   counts; over-cap clients are deferred, never fetched.
//   LAW 3 — a client refreshed within 7 days is skipped BEFORE any spend.
//   LAW 4 — a failed fetch touches nothing (stored reviews stand, warn only)
//   and getReviewsForBuild is PURE — it never fetches inside page rendering.

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_REFRESH_CAP,
  PLACES_FIELD_MASK,
  fetchPlaceReviews,
  getReviewsForBuild,
  isRefreshDue,
  placeIdFromBusiness,
  refreshCapFromEnv,
  runReviewsRefresh,
} = require("../lib/reviews-refresh");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-02T12:00:00.000Z");

const client = (over = {}) => ({
  id: "row-1",
  google_place_id: "PLACE_ABC",
  reviews: [{ text: "Stored build-time review", author: "Ana", rating: 5 }],
  ...over,
});

const okFetch = (reviews) => async (url, init) => ({
  ok: true,
  status: 200,
  json: async () => ({ reviews: reviews.map((r, i) => ({
    rating: r.rating ?? 5,
    text: { text: r.text ?? `Fresh review ${i}` },
    authorAttribution: { displayName: r.author ?? "Fresh Author" },
    publishTime: "2026-08-30T10:00:00Z",
  })) }),
});

// ---------------------------------------------------------------------------
// LAW 1: the wire shape is reviews-only
// ---------------------------------------------------------------------------

test("Places fetch is a GET places/{id} with the reviews field mask ONLY — no photos, no details", async () => {
  const seen = [];
  await fetchPlaceReviews({
    placeId: "PLACE_ABC",
    apiKey: "key-test",
    fetchImpl: async (url, init) => {
      seen.push({ url: String(url), init });
      return (await okFetch([])(url, init));
    },
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://places.googleapis.com/v1/places/PLACE_ABC");
  assert.equal(seen[0].init.method, "GET");
  // THE LINE THE $1k INCIDENT BOUGHT. Byte-for-byte: adding `photos` or any
  // details field here is the exact defect class this module exists to make
  // impossible.
  assert.equal(seen[0].init.headers["X-Goog-FieldMask"], "reviews");
  assert.equal(PLACES_FIELD_MASK, "reviews");
  assert.doesNotMatch(PLACES_FIELD_MASK, /photos|displayName|address|phone|openingHours/i);
});

test("the field mask constant is the ONLY mask the module defines", () => {
  const source = readFileSync(path.join(__dirname, "..", "lib", "reviews-refresh.js"), "utf8");
  assert.match(source, /const PLACES_FIELD_MASK = "reviews";/);
  assert.doesNotMatch(source, /places:searchText|places:photos|PLACES_BASE = "https:\/\/places\.googleapis\.com\/v1\/places\/[^"]*photos/);
  assert.doesNotMatch(source, /"X-Goog-FieldMask": "(?!reviews)/);
});

test("normalized reviews keep the stored shape and drop textless stars", () => {
  return (async () => {
    const outcome = await fetchPlaceReviews({
      placeId: "PLACE_ABC",
      apiKey: "key-test",
      fetchImpl: okFetch([
        { text: "Great crew", rating: 5, author: "Dana" },
        { text: "  ", rating: 2, author: "NoWords" },
      ]),
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.reviews.length, 1);
    assert.deepEqual(outcome.reviews[0], {
      text: "Great crew",
      author: "Dana",
      avatarUrl: "",
      rating: 5,
      publishedAt: "2026-08-30T10:00:00Z",
    });
  })();
});

// ---------------------------------------------------------------------------
// LAW 2: the per-run cap
// ---------------------------------------------------------------------------

test("the cap stops Places spend mid-run; over-cap clients are deferred, never fetched", async () => {
  let calls = 0;
  const updates = [];
  const clients = [1, 2, 3, 4, 5].map((n) => client({ id: `row-${n}`, google_place_id: `P${n}` }));
  const outcome = await runReviewsRefresh({
    clients,
    apiKey: "key-test",
    cap: 2,
    nowMs: NOW,
    fetchImpl: async () => { calls += 1; return okFetch([{ text: "Fresh" }])(); },
    updateClient: async (row, patch) => { updates.push({ id: row.id, patch }); },
  });
  assert.equal(calls, 2, "exactly cap Places calls");
  assert.equal(outcome.attempts, 2);
  assert.equal(outcome.refreshed, 2);
  assert.equal(outcome.cap_deferred, 3, "the rest are reported, not fetched");
  assert.equal(updates.length, 2);
  assert.deepEqual(outcome.results.filter((r) => r.status === "cap_deferred").map((r) => r.id),
    ["row-3", "row-4", "row-5"]);
});

test("the cap default is 25 and env parsing clamps to a sane positive integer", () => {
  assert.equal(DEFAULT_REFRESH_CAP, 25);
  assert.equal(refreshCapFromEnv({}), 25);
  assert.equal(refreshCapFromEnv({ GOOGLE_REVIEW_REFRESH_CAP: "10" }), 10);
  assert.equal(refreshCapFromEnv({ GOOGLE_REVIEW_REFRESH_CAP: "junk" }), 25);
  assert.equal(refreshCapFromEnv({ GOOGLE_REVIEW_REFRESH_CAP: "0" }), 25);
  assert.equal(refreshCapFromEnv({ GOOGLE_REVIEW_REFRESH_CAP: "-5" }), 25);
  assert.equal(refreshCapFromEnv({ GOOGLE_REVIEW_REFRESH_CAP: "100000" }), 200);
});

test("every Places call counts against the cap — even failures", async () => {
  let calls = 0;
  const outcome = await runReviewsRefresh({
    clients: [client({ id: "a" }), client({ id: "b" })],
    apiKey: "key-test",
    cap: 1,
    nowMs: NOW,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 500, error: "http_500" }; },
  });
  assert.equal(calls, 1);
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.cap_deferred, 1, "the second client is deferred, not fetched after the cap call failed");
});

// ---------------------------------------------------------------------------
// LAW 3: the 7-day per-client throttle
// ---------------------------------------------------------------------------

test("a client refreshed inside 7 days is skipped BEFORE any Places call", async () => {
  let calls = 0;
  const outcome = await runReviewsRefresh({
    clients: [client({ reviews_refreshed_at: new Date(NOW - 3 * DAY_MS).toISOString() })],
    apiKey: "key-test",
    cap: 25,
    nowMs: NOW,
    fetchImpl: async () => { calls += 1; return okFetch([])(); },
    updateClient: async () => { assert.fail("throttled client must not be persisted"); },
  });
  assert.equal(calls, 0, "zero spend on a warm record");
  assert.equal(outcome.throttled, 1);
  assert.equal(outcome.attempts, 0);
  assert.equal(isRefreshDue(client({ reviews_refreshed_at: new Date(NOW - 3 * DAY_MS).toISOString() }), NOW), false);
  assert.equal(isRefreshDue(client({ reviews_refreshed_at: new Date(NOW - 8 * DAY_MS).toISOString() }), NOW), true);
  assert.equal(isRefreshDue(client({}), NOW), true, "never-refreshed records are due");
});

test("a client at 8 days is refreshed and the new stamp plus reviews are persisted", async () => {
  const updates = [];
  const outcome = await runReviewsRefresh({
    clients: [client({ reviews_refreshed_at: new Date(NOW - 8 * DAY_MS).toISOString(), reviews: [{ text: "Old" }] })],
    apiKey: "key-test",
    cap: 25,
    nowMs: NOW,
    fetchImpl: okFetch([{ text: "Brand new", rating: 4 }]),
    updateClient: async (row, patch) => { updates.push(patch); },
  });
  assert.equal(outcome.refreshed, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].reviews_refreshed_at, new Date(NOW).toISOString());
  assert.equal(updates[0].reviews[0].text, "Brand new");
});

test("place ids resolve from every stored record shape", () => {
  assert.equal(placeIdFromBusiness(client()), "PLACE_ABC");
  assert.equal(placeIdFromBusiness({ place_id: "P2" }), "P2");
  assert.equal(placeIdFromBusiness({ mirror_request: { facts: { place_id: "P3" } } }), "P3");
  assert.equal(placeIdFromBusiness({}), "");
});

// ---------------------------------------------------------------------------
// LAW 4: silent fallback + the pure build-time door
// ---------------------------------------------------------------------------

test("a failed fetch touches NOTHING: stored reviews and the old stamp stand", async () => {
  const before = client({
    reviews: [{ text: "Stored review", author: "Ana", rating: 5 }],
    reviews_refreshed_at: new Date(NOW - 20 * DAY_MS).toISOString(),
  });
  const warnings = [];
  const updates = [];
  const outcome = await runReviewsRefresh({
    clients: [before],
    apiKey: "key-test",
    cap: 25,
    nowMs: NOW,
    fetchImpl: async () => ({ ok: false, status: 503, error: "http_503" }),
    logger: { warn: (line) => warnings.push(line) },
    updateClient: async (row, patch) => { updates.push(patch); },
  });
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.refreshed, 0);
  assert.equal(updates.length, 0, "no persistence on failure");
  assert.equal(warnings.length, 1, "warn log only");
  assert.match(warnings[0], /fallback/);
  assert.deepEqual(before.reviews, [{ text: "Stored review", author: "Ana", rating: 5 }]);
  assert.equal(before.reviews_refreshed_at, new Date(NOW - 20 * DAY_MS).toISOString());
});

test("a thrown fetch is contained to the client and the run still completes", async () => {
  const outcome = await runReviewsRefresh({
    clients: [client({ id: "boom" })],
    apiKey: "key-test",
    cap: 25,
    nowMs: NOW,
    fetchImpl: async () => { throw new Error("network down"); },
    updateClient: async () => { assert.fail("must not persist after a throw"); },
  });
  assert.equal(outcome.failed, 1);
  assert.equal(outcome.results[0].status, "failed");
});

test("an empty Google answer stamps the check but never wipes stored reviews", async () => {
  const updates = [];
  const outcome = await runReviewsRefresh({
    clients: [client({ reviews: [{ text: "Stored" }] })],
    apiKey: "key-test",
    cap: 25,
    nowMs: NOW,
    fetchImpl: okFetch([]),
    updateClient: async (row, patch) => { updates.push(patch); },
  });
  assert.equal(outcome.empty, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].reviews, undefined, "stored reviews untouched");
  assert.ok(updates[0].reviews_refreshed_at);
});

test("getReviewsForBuild is PURE: live when fresh, stored when stale, never a fetch", () => {
  const live = [{ text: "Live synced", author: "Rae", rating: 5 }];
  const stored = [{ text: "Build-time stored", author: "Ana", rating: 4 }];

  const fresh = getReviewsForBuild({
    reviews: live,
    stored_reviews: stored,
    reviews_refreshed_at: new Date(NOW - 1 * DAY_MS).toISOString(),
  }, NOW);
  assert.deepEqual(fresh, live, "fresh (<7d) stamp -> live reviews");

  const stale = getReviewsForBuild({
    reviews: live,
    stored_reviews: stored,
    reviews_refreshed_at: new Date(NOW - 8 * DAY_MS).toISOString(),
  }, NOW);
  assert.deepEqual(stale, stored, "stale stamp -> the build-time stored reviews");

  const never = getReviewsForBuild({ reviews: stored }, NOW);
  assert.deepEqual(never, stored, "never-refreshed record renders what it always had");

  assert.deepEqual(getReviewsForBuild({}, NOW), [], "nothing stored -> empty list, never a throw");
});

// ---------------------------------------------------------------------------
// THE ROUTE: feature off, bounded scans
// ---------------------------------------------------------------------------

test("the cron route answers feature_off with zero spend while the Places key is absent", async () => {
  const handler = require("../api/cron/refresh-reviews");
  const previousKey = process.env.GOOGLE_PLACES_API_KEY;
  const previousSecret = process.env.CRON_SECRET;
  delete process.env.GOOGLE_PLACES_API_KEY;
  process.env.CRON_SECRET = "test-cron-secret";
  let placesCalls = 0;
  const nativeFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("places.googleapis.com")) { placesCalls += 1; }
    return nativeFetch(url);
  };
  try {
    let status = 0;
    let body = null;
    const fakeRes = {
      set statusCode(code) { status = code; },
      get statusCode() { return status; },
      setHeader() {},
      end: (chunk) => { body = String(chunk || ""); return fakeRes; },
    };
    await handler({ method: "GET", url: "/", headers: { authorization: "Bearer test-cron-secret" } }, fakeRes);
    assert.equal(status, 200);
    const json = JSON.parse(body);
    assert.equal(json.ok, true);
    assert.equal(json.mode, "feature_off");
    assert.equal(placesCalls, 0, "feature off = zero Places calls");
  } finally {
    global.fetch = nativeFetch;
    if (previousKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = previousKey;
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  }
});

test("candidate selection is bounded and falls back to a bounded scan", async () => {
  const route = require("../api/cron/refresh-reviews");
  const { selectCandidates, SCAN_LIMIT, withPlaceId } = route._test;
  assert.ok(SCAN_LIMIT >= 1 && SCAN_LIMIT <= 1000, "the scan is bounded");

  const rows = [
    { id: "has-place", record: { google_place_id: "P1" } },
    { id: "no-place", record: {} },
    { id: "column-place", place_id: "P2" },
  ];
  assert.deepEqual(withPlaceId(rows).map((r) => r.id), ["has-place", "column-place"]);

  const filtered = await selectCandidates(async (table, query) => {
    assert.equal(table, "ghost_agency_prospects");
    assert.match(query, /record->>google_place_id=not\.is\.null/);
    return { ok: true, data: rows };
  });
  assert.equal(filtered.ok, true);
  assert.equal(filtered.rows.length, 2);

  const fallback = await selectCandidates(async (table, query) => {
    if (query.includes("record->>google_place_id")) return { ok: false, skipped: "schema_cache" };
    return { ok: true, data: rows };
  });
  assert.equal(fallback.ok, true);
  assert.equal(fallback.scanned_unfiltered, true);
  assert.equal(fallback.rows.length, 2);

  const blocked = await selectCandidates(async () => ({ ok: false, skipped: "supabase_not_configured" }));
  assert.equal(blocked.ok, false);
});
