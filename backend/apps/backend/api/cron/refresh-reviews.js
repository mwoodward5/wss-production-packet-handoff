"use strict";

// api/cron/refresh-reviews.js — the OPTIONAL live review sync (daily).
//
// COST LAWS (see lib/reviews-refresh.js — the ~$1k Google Places image-call
// incident is the reason every one of these exists):
//   · GOOGLE_PLACES_API_KEY absent -> feature OFF, zero calls, 200 feature_off.
//   · Reviews field ONLY (X-Goog-FieldMask: reviews — no photos, no details).
//   · Max GOOGLE_REVIEW_REFRESH_CAP Places calls per run (default 25), and
//     every call counts against the cap.
//   · Per-client 7-day throttle (persisted reviews_refreshed_at) checked
//     BEFORE any spend.
//   · Any per-client failure is a warn log and a silent fall-back to the
//     stored reviews. This route never fails a site, and never throws.

const { requireCron } = require("../../lib/cron-auth");
const { methodGuard, sendJson } = require("../../lib/http");
const { event, select, conditionalUpdate } = require("../../lib/store");
const {
  placeIdFromBusiness,
  refreshCapFromEnv,
  refreshTimeoutMs,
  runReviewsRefresh,
} = require("../../lib/reviews-refresh");

const PROSPECTS_TABLE = "ghost_agency_prospects";
// The candidate scan is bounded no matter how the filter resolves — the cost
// cap protects Places spend, and this bound protects the function's runtime.
const SCAN_LIMIT = 250;

function dryRun(req) {
  const url = new URL(req.url || "/", "https://ghost-agency.invalid");
  return ["true", "1", "yes"].includes(String(url.searchParams.get("dry_run") || "").toLowerCase());
}

function embeddedRecord(row = {}) {
  const record = row.record;
  if (record && typeof record === "object" && !Array.isArray(record)) return record;
  if (typeof record === "string") {
    try {
      const parsed = JSON.parse(record);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Candidates, filtered in JS so the record shapes stay the one source of truth. */
function withPlaceId(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => placeIdFromBusiness(row));
}

async function selectCandidates(selectFn) {
  // PostgREST JSONB filter first (cheap for Postgres); the bounded unfiltered
  // scan is the fallback for schema caches that refuse the operator.
  const filtered = await selectFn(
    PROSPECTS_TABLE,
    `?select=*&record->>google_place_id=not.is.null&limit=${SCAN_LIMIT}`,
  );
  if (filtered.ok) return { ok: true, rows: withPlaceId(filtered.data) };
  const scan = await selectFn(
    PROSPECTS_TABLE,
    `?select=*&order=updated_at.desc.nullslast&limit=${SCAN_LIMIT}`,
  );
  if (!scan.ok) return { ok: false, transport: scan.skipped || scan.status || scan.mode };
  return { ok: true, rows: withPlaceId(scan.data), scanned_unfiltered: true };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireCron(req, res)) return;

  // FEATURE OFF = a clean, free answer. Sites keep rendering the reviews
  // collected at build time; nothing here is required for a build to work.
  const apiKey = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!apiKey) {
    sendJson(res, 200, {
      ok: true,
      mode: "feature_off",
      job: "refresh-reviews",
      reason: "GOOGLE_PLACES_API_KEY not set — live review sync disabled; sites render stored reviews.",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const isDryRun = dryRun(req);
  const cap = refreshCapFromEnv(process.env);
  const candidates = await selectCandidates(select);
  if (!candidates.ok) {
    await event({
      type: "cron.run",
      actor: "agent_00_orchestrator",
      status: "failed",
      payload: {
        job: "refresh-reviews",
        blocked: "ghost_agency_prospects_unavailable",
        transport: candidates.transport,
      },
    });
    sendJson(res, 200, {
      ok: false,
      mode: "schema_blocked",
      job: "refresh-reviews",
      blocker: "ghost_agency_prospects table/query is not available in the current Supabase schema.",
      transport: candidates.transport,
    });
    return;
  }

  // The persistence door: merge the patch into the row's own record object so
  // nothing else in the record is touched. An update failure is recorded as a
  // per-client failure and the stored reviews simply stand.
  const nowIso = new Date().toISOString();
  const updateClient = async (row, patch) => {
    if (isDryRun) return true;
    const record = { ...embeddedRecord(row), ...patch };
    const updated = await conditionalUpdate(PROSPECTS_TABLE, "id", row.id, {}, { record, updated_at: nowIso });
    return updated.ok === true && updated.updated === true;
  };

  let outcome;
  try {
    outcome = await runReviewsRefresh({
      clients: candidates.rows,
      apiKey,
      cap,
      nowMs: Date.now(),
      updateClient,
      timeoutMs: refreshTimeoutMs(process.env),
    });
  } catch (error) {
    // Unreachable by contract (runReviewsRefresh never throws) — belt and
    // braces for LAW 4: the cron answers, it never crashes.
    await event({
      type: "cron.run",
      actor: "agent_00_orchestrator",
      status: "failed",
      payload: { job: "refresh-reviews", error: String((error && error.message) || error) },
    });
    sendJson(res, 200, {
      ok: false,
      mode: "refresh_error",
      job: "refresh-reviews",
      error: "refresh_failed",
      timestamp: nowIso,
    });
    return;
  }

  await event({
    type: "cron.run",
    actor: "agent_00_orchestrator",
    status: "ok",
    payload: {
      job: "refresh-reviews",
      dry_run: isDryRun,
      cap,
      candidates: (candidates.rows || []).length,
      places_calls: outcome.attempts,
      refreshed: outcome.refreshed,
      failed: outcome.failed,
    },
  });

  sendJson(res, 200, {
    ok: true,
    mode: isDryRun ? "dry_run" : outcome.attempts ? "refreshed" : "no_op",
    job: "refresh-reviews",
    cap,
    bounded: true,
    scanned_unfiltered: Boolean(candidates.scanned_unfiltered),
    candidates: (candidates.rows || []).length,
    places_calls: outcome.attempts,
    refreshed: outcome.refreshed,
    empty: outcome.empty,
    failed: outcome.failed,
    throttled: outcome.throttled,
    no_place_id: outcome.no_place_id,
    cap_deferred: outcome.cap_deferred,
    results: outcome.results,
    timestamp: nowIso,
  });
};

module.exports._test = { embeddedRecord, selectCandidates, withPlaceId, SCAN_LIMIT };
