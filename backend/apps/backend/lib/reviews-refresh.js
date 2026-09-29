"use strict";

// lib/reviews-refresh.js — the OPTIONAL live review sync. THE COST-LAW FILE.
//
// This team was burned ~$1,000 by Google Places image calls (photo media is
// billed per photo resolved). The laws below are not style preferences; they
// are the reason this module exists in exactly this shape:
//
//   LAW 1 — REVIEWS FIELD ONLY. Every network call this module makes is a
//   single GET places/{place_id} with `X-Goog-FieldMask: reviews`. No photos,
//   no details mask beyond reviews, ever. The mask is a module-level constant
//   (PLACES_FIELD_MASK) precisely so a test can pin it byte-for-byte.
//
//   LAW 2 — DAILY RUN CAP. At most N Places calls per refresh run (env
//   GOOGLE_REVIEW_REFRESH_CAP, default 25). EVERY call counts against the cap
//   — success, empty, or failure — because a 4xx can still be a billed
//   request. Once the cap is hit the run stops; the remaining clients are
//   reported as `cap_deferred`, never fetched.
//
//   LAW 3 — 7-DAY PER-CLIENT THROTTLE. A client refreshed within the last
//   7 days (persisted `reviews_refreshed_at` on the client record) is skipped
//   before any network call is attempted. The throttle runs BEFORE the cap so
//   a warm fleet spends zero.
//
//   LAW 4 — SILENT FALLBACK. A failed fetch leaves the client's stored reviews
//   and its previous stamp untouched (warn log only). The site never breaks on
//   review refresh: `getReviewsForBuild` is a PURE function — it reads what is
//   already persisted and never fetches anything inside page rendering.
//
// `GOOGLE_PLACES_API_KEY` absent = the whole feature is OFF. Callers answer
// `feature_off` and sites simply keep rendering the reviews collected at
// build time.

const DEFAULT_REFRESH_CAP = 25;
const MAX_REFRESH_CAP = 200;
const REFRESH_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const PLACES_BASE = "https://places.googleapis.com/v1/places/";
// LAW 1, pinned: the ONE field mask this module may ever send.
const PLACES_FIELD_MASK = "reviews";

/** Positive integer from env, clamped to [1, MAX_REFRESH_CAP]; junk -> fallback. */
function refreshCapFromEnv(env = process.env) {
  const parsed = parseInt(String(env.GOOGLE_REVIEW_REFRESH_CAP ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REFRESH_CAP;
  return Math.min(parsed, MAX_REFRESH_CAP);
}

function refreshTimeoutMs(env = process.env) {
  const parsed = parseInt(String(env.GOOGLE_REVIEW_REFRESH_TIMEOUT_MS ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(parsed, 60_000);
}

/** A place id is an opaque Google token — shape-checked, never reformatted. */
function cleanPlaceId(value) {
  const id = String(value || "").trim();
  return id && id.length <= 255 && !/[\u0000-\u001f\u007f]/.test(id) ? id : "";
}

/** The verified Google identity pin, wherever the record shape carries it. */
function placeIdFromBusiness(business = {}) {
  for (const value of [
    business.google_place_id,
    business.placeId,
    business.place_id,
    business.record?.google_place_id,
    business.record?.place_id,
    business.mirror_request?.facts?.place_id,
    business.build_ready?.mirror_request?.facts?.place_id,
  ]) {
    const id = cleanPlaceId(value);
    if (id) return id;
  }
  return "";
}

/** The persisted refresh stamp, parsed safely. NaN when never refreshed. */
function lastRefreshedAt(business = {}) {
  return Date.parse(String(business.reviews_refreshed_at || ""));
}

/** LAW 3: due when never refreshed, or the stamp is 7+ days old. */
function isRefreshDue(business = {}, now = Date.now()) {
  const last = lastRefreshedAt(business);
  if (!Number.isFinite(last)) return true;
  return now - last >= REFRESH_INTERVAL_DAYS * DAY_MS;
}

/**
 * THE BUILD-TIME DOOR (LAW 4). Pure — no fetch, no await, no I/O.
 *
 * Live-fresh: the record's `reviews` were synced by a refresh run less than
 * 7 days ago -> render them. Otherwise fall back to the reviews collected at
 * build time (`stored_reviews` on refreshed records, which is the same array
 * the site always rendered) and finally to whatever `reviews` holds on a
 * never-refreshed record. An empty/absent everywhere answer is an empty list,
 * never a fetch and never a throw.
 */
function getReviewsForBuild(business = {}, now = Date.now()) {
  const reviews = Array.isArray(business.reviews) ? business.reviews : [];
  const last = lastRefreshedAt(business);
  const fresh = Number.isFinite(last) && now - last < REFRESH_INTERVAL_DAYS * DAY_MS;
  if (fresh && reviews.length) return reviews;
  const stored = Array.isArray(business.stored_reviews) ? business.stored_reviews : null;
  return stored || reviews;
}

/**
 * Places (New) GET-by-id, reviews field ONLY (LAW 1). Resolves to
 * { ok:true, status, reviews } or { ok:false, status, error }; never throws.
 */
async function fetchPlaceReviews({ placeId, apiKey, fetchImpl = global.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const id = cleanPlaceId(placeId);
  const key = String(apiKey || "").trim();
  if (!id || !key) return { ok: false, status: 0, error: !id ? "no_place_id" : "no_api_key" };
  try {
    const res = await fetchImpl(`${PLACES_BASE}${encodeURIComponent(id)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": key,
        // LAW 1. Byte-for-byte pinned by test. Adding ANY other field here —
        // above all `photos` — is the exact incident class that cost $1k.
        "X-Goog-FieldMask": PLACES_FIELD_MASK,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}` };
    }
    return { ok: true, status: res.status, reviews: normalizePlaceReviews(json) };
  } catch (error) {
    return { ok: false, status: 0, error: String((error && error.name) || error || "fetch_failed") };
  }
}

/**
 * Places (New) review shape -> the stored review shape the mirrors already
 * render (author/text/avatarUrl/rating/publishedAt). A review with no text is
 * a star with no words — dropped, exactly like every other transport.
 */
function normalizeGoogleReview(review = {}) {
  const text = String((review.text && review.text.text)
    || (review.originalText && review.originalText.text)
    || "").trim();
  if (!text) return null;
  const rating = Number(review.rating);
  return {
    text,
    author: String(review.authorAttribution?.displayName || "").trim(),
    avatarUrl: /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(String(review.authorAttribution?.photoUri || ""))
      ? String(review.authorAttribution.photoUri)
      : "",
    rating: Number.isFinite(rating) ? Math.max(0, Math.min(5, Math.round(rating))) : 0,
    publishedAt: Number.isFinite(Date.parse(String(review.publishTime || "")))
      ? String(review.publishTime)
      : "",
  };
}

function normalizePlaceReviews(json) {
  const list = Array.isArray(json && json.reviews) ? json.reviews : [];
  return list.map(normalizeGoogleReview).filter(Boolean);
}

function storedReviewsOf(business = {}) {
  return Array.isArray(business.reviews) ? business.reviews : [];
}

/**
 * THE CORE LOOP. `clients` are plain records; `updateClient(row, patch)` is
 * the caller's persistence door (returns a promise/boolean). Every step is
 * bounded, every failure is contained to its own client, and the run-level
 * contract NEVER throws.
 *
 * @returns {Promise<{attempts:number, refreshed:number, empty:number, failed:number,
 *   throttled:number, no_place_id:number, cap_deferred:number, results:Array}>}
 */
async function runReviewsRefresh({
  clients = [],
  apiKey = "",
  cap = DEFAULT_REFRESH_CAP,
  fetchImpl = global.fetch,
  nowMs = Date.now(),
  updateClient = null,
  logger = { warn() {} },
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const results = [];
  let attempts = 0;
  let refreshed = 0;
  let empty = 0;
  let failed = 0;
  let throttled = 0;
  let noPlaceId = 0;
  let capDeferred = 0;
  const stamp = new Date(nowMs).toISOString();

  for (const client of Array.isArray(clients) ? clients : []) {
    const id = client && (client.id ?? client.prospect_id ?? "");
    const placeId = placeIdFromBusiness(client || {});

    if (!placeId) {
      noPlaceId += 1;
      results.push({ id, status: "no_place_id" });
      continue;
    }
    if (!isRefreshDue(client, nowMs)) {
      // LAW 3: skip BEFORE any spend.
      throttled += 1;
      results.push({ id, status: "throttled", last_refresh: client.reviews_refreshed_at });
      continue;
    }
    if (attempts >= cap) {
      // LAW 2: hard stop. Report, never fetch.
      capDeferred += 1;
      results.push({ id, status: "cap_deferred" });
      continue;
    }
    // LAW 2: every Places call counts, success or not.
    attempts += 1;
    try {
      const outcome = await fetchPlaceReviews({ placeId, apiKey, fetchImpl, timeoutMs });
      if (!outcome.ok) {
        // LAW 4: warn, touch nothing, move on. The stored reviews stand.
        failed += 1;
        logger.warn(JSON.stringify({
          event: "reviews_refresh_failed",
          client_id: id,
          place_id: placeId,
          status: outcome.status,
          error: outcome.error,
          fallback: "stored_reviews",
        }));
        results.push({ id, status: "failed", error: outcome.error });
        continue;
      }
      if (!outcome.reviews.length) {
        // Google answered but had no review text. Stamp the check (so we do
        // not pay to look again tomorrow) and KEEP the stored reviews — an
        // empty answer never wipes real ones.
        empty += 1;
        if (updateClient) await updateClient(client, { reviews_refreshed_at: stamp });
        results.push({ id, status: "empty", kept_stored_reviews: storedReviewsOf(client).length });
        continue;
      }
      if (updateClient) {
        await updateClient(client, { reviews: outcome.reviews, reviews_refreshed_at: stamp });
      }
      refreshed += 1;
      results.push({ id, status: "refreshed", reviews: outcome.reviews.length });
    } catch (error) {
      // LAW 4: a client failure is a warn line, never a run failure.
      failed += 1;
      logger.warn(JSON.stringify({
        event: "reviews_refresh_failed",
        client_id: id,
        place_id: placeId,
        error: String((error && error.message) || error || "refresh_failed"),
        fallback: "stored_reviews",
      }));
      results.push({ id, status: "failed", error: "refresh_failed" });
    }
  }

  return {
    attempts,
    refreshed,
    empty,
    failed,
    throttled,
    no_place_id: noPlaceId,
    cap_deferred: capDeferred,
    results,
  };
}

module.exports = {
  DEFAULT_REFRESH_CAP,
  DEFAULT_TIMEOUT_MS,
  DAY_MS,
  MAX_REFRESH_CAP,
  PLACES_BASE,
  PLACES_FIELD_MASK,
  REFRESH_INTERVAL_DAYS,
  cleanPlaceId,
  fetchPlaceReviews,
  getReviewsForBuild,
  isRefreshDue,
  lastRefreshedAt,
  normalizeGoogleReview,
  normalizePlaceReviews,
  placeIdFromBusiness,
  refreshCapFromEnv,
  refreshTimeoutMs,
  runReviewsRefresh,
  storedReviewsOf,
};
