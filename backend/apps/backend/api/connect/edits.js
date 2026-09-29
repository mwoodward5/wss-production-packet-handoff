"use strict";

// GET /api/connect/edits — the customer's own record of what they asked for.
//
// The chat panel's transcript and its status poller are the same call. Every
// row is a real ghost_agency_edit_jobs row, so a change the customer asked
// Riley for on the phone appears here too — there is one queue, and this is a
// window onto it rather than a second copy of it.
//
// Scoped exactly like api/connect/site.js: a tenant token is pinned to the slug
// it was signed for, a full/admin token may name one, and naming none gets an
// empty surface rather than somebody else's.
//
// A FAILED READ IS NOT AN EMPTY TRANSCRIPT. `ok:false` travels to the page so
// the panel can say it could not load the history, instead of implying the
// customer never asked for anything.

const { resolveConnectScope } = require("../../lib/connect");
const { select, upsertRow, recordEvent } = require("../../lib/store");
const { listCustomerEdits, DEFAULT_LIMIT } = require("../../lib/customer-edits");
const { maybeSweepDeadEditJobs } = require("../../lib/edit-job-sweeper");

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

function cors(req, res) {
  const origin = String(req.headers.origin || "");
  const allowed = ["https://connect.wss-labs.com", "https://wss-ai.com", "https://www.wss-ai.com"];
  res.setHeader("Access-Control-Allow-Origin", allowed.includes(origin) ? origin : "https://wss-ai.com");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-connect-token, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return true; }
  return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }
  const scope = resolveConnectScope(req);
  if (!scope) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
  }

  const asked = String((req.query && req.query.slug) || "").trim().toLowerCase();
  const siteSlug = scope.mode === "tenant"
    ? String(scope.siteSlug || "")
    : (SLUG_RE.test(asked) ? asked : "");

  res.setHeader("Content-Type", "application/json");
  // Never cached: this is the surface a customer watches while a change runs.
  res.setHeader("Cache-Control", "no-store");

  if (!SLUG_RE.test(siteSlug)) {
    return res.end(JSON.stringify({ ok: true, edits: [], reason: "no_site_bound_to_this_login" }));
  }

  const limit = Math.max(1, Math.min(50, Number((req.query && req.query.limit) || DEFAULT_LIMIT) || DEFAULT_LIMIT));
  try {
    // THE SAFETY NET, HITCHING A RIDE ON THE POLL. api/cron/run-edit-jobs.js is
    // the designed sweeper, but the Vercel project's cron switch has been off
    // since 2026-07-29 and that route has therefore never run — which is how
    // three jobs came to sit open for 33 hours and 15 days. A queue that can
    // only heal on a schedule somebody can switch off does not heal. This is
    // the trigger that cannot be switched off: it fires from the request the
    // customer's own dashboard is already making, throttled to once a minute
    // per instance, and it only ever CLOSES dead rows — it never starts work,
    // so a poll can never turn into a deploy.
    await maybeSweepDeadEditJobs({ select, upsertRow, recordEvent }).catch(() => null);
    const { ok, edits } = await listCustomerEdits({ siteSlug, select, limit });
    return res.end(JSON.stringify({ ok, edits, ...(ok ? {} : { reason: "history_unreadable" }) }));
  } catch (error) {
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, edits: [], error: String((error && error.message) || error) }));
  }
};
