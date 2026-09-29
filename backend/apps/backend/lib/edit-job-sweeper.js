"use strict";

// lib/edit-job-sweeper.js — the half of the edit queue that CLOSES jobs.
//
// WHY THIS FILE EXISTS. The runner (lib/edit-job-runner.js) knows how to DO an
// edit. Nothing knew how to give up on one. Measured on 2026-08-08: three rows
// in ghost_agency_edit_jobs were still open — one "queued" since 2026-07-24 (15
// days) and two "running" since 2026-08-07T14:28 (33 hours) — every one of them
// telling its customer "Working…" on a job with no worker behind it.
//
// TWO INDEPENDENT REASONS THAT HAPPENED, both real, both fixed here:
//
//   1. NOTHING SWEPT. api/cron/run-edit-jobs.js is the documented safety net,
//      but the Vercel project's cron switch has been OFF since
//      2026-07-29T23:31:39Z (project prj_WHDPMZW56KiNFpcKt8DGgsUdxwyU,
//      crons.disabledAt, verified against the API). The `*/2` sweeper was added
//      six days AFTER that, so it has never once executed. A safety net that
//      hangs off a scheduler somebody switched off is not a safety net, so the
//      sweep also runs OPPORTUNISTICALLY from the request paths the customer is
//      already touching — see api/connect/edits.js.
//
//   2. NOTHING TIMED OUT. Both live callers race executeEditJob against a
//      12s/22s budget and then answer; a serverless instance can freeze at that
//      point and take the unfinished job with it, leaving the row stamped
//      "running" with no terminal write ever. The runner now carries its own
//      deadline for the live case; this module is for the case where the
//      process is simply gone and no deadline inside it can fire.
//
// WHY THIS IS A SEPARATE MODULE FROM THE RUNNER. api/connect/edits.js is the
// poll the dashboard makes every few seconds. Requiring the runner there would
// drag lib/site-change-plan.js — the whole planner, the deploy client — into
// the cold start of a read-only list. This module needs nothing but the store.
//
// WHAT IT WILL NOT DO: re-run anything. Re-running means deploying to a paying
// customer's live website with nobody watching, on a guess about whether the
// first attempt got that far. drainEditQueue re-runs (it is a cron with 300
// seconds and a retry budget); the sweep only ever writes a truthful ending.

/** A "running" claim older than this cannot have a live worker behind it:
 *  vercel.json caps every api/** function at maxDuration 300 (5 minutes), so a
 *  claim that has not been touched in ten is a dead process, not a slow one. */
const STALE_RUNNING_MS = 10 * 60 * 1000;

/** Past this, nothing reclaimed it and nothing is going to. The gap between
 *  this and STALE_RUNNING_MS is the window drainEditQueue gets to retry in —
 *  when the cron is running it re-runs at ten minutes and bumps updated_at, so
 *  a row only ever reaches twenty if genuinely nobody is home. That is how the
 *  sweep and the drain avoid fighting over the same row. */
const ABANDONED_MS = 20 * 60 * 1000;

/** A "queued" row this old was never picked up by the inline kick or the cron. */
const NEVER_STARTED_MS = 20 * 60 * 1000;

/** How many times one job may be started before we stop trying. */
const MAX_ATTEMPTS = 2;

/** How often an opportunistic caller may actually pay for a sweep. */
const SWEEP_MIN_INTERVAL_MS = 60 * 1000;

// THE SENTENCES. Each has to be true of a row in that state with nothing else
// known — the same bar lib/customer-edits.js sets for its own copy.
//
// The abandoned one is deliberately not "nothing changed". We do not know that.
// The worker died somewhere between reading the site and deploying it, and
// claiming either outcome would be inventing one. Naming the uncertainty is the
// only honest move, and it is still infinitely better than a spinner.
const ABANDONED_SAY =
  "This change stopped partway through, and we can't confirm whether it reached your site — so we won't claim either way. Open your page to see where it stands, then send it again or call Riley and we'll finish it.";

const NEVER_STARTED_SAY =
  "This request never got started, so nothing on your site changed. Send it again and we'll pick it straight up.";

/** How many times this job has been claimed. Carried in `result` because
 *  ghost_agency_edit_jobs has eight columns and none of them is a counter (see
 *  sql/edit_jobs.sql); `result` is jsonb and is written on every claim. */
function attemptsOf(row) {
  const result = row && row.result;
  const n = result && typeof result === "object" ? Number(result.attempts) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function parseStamp(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? at : null;
}

/**
 * classifyStuckJob(row, now) -> { state, reason, ageMs, attempts }
 *
 * ONE CLASSIFIER, BOTH CALLERS. drainEditQueue re-runs what this calls
 * "retryable" and the sweep closes what it calls "dead". They cannot disagree
 * about a row because they are asking the same function.
 *
 *   in_flight — a live worker plausibly still has it. Leave it alone.
 *   retryable — no live worker, but it still has an attempt left and the drain
 *               may yet get to it.
 *   dead      — out of attempts, or out of time, or corrupt. Close it.
 *   settled   — already terminal.
 */
function classifyStuckJob(row, now = Date.now()) {
  const status = String((row && row.status) || "").toLowerCase();
  const attempts = attemptsOf(row);

  if (status !== "queued" && status !== "running") {
    return { state: "settled", reason: status || "unknown", ageMs: 0, attempts };
  }

  const created = parseStamp(row && row.created_at);
  const touched = status === "running" ? parseStamp(row && row.updated_at) || created : created;

  // A row we cannot date is a row we cannot reason about, and it is showing
  // somebody a spinner. Corrupt is an ending too, and a named one.
  if (touched == null) {
    return { state: "dead", reason: "unreadable_timestamps", ageMs: 0, attempts };
  }

  const ageMs = Math.max(0, now - touched);

  if (status === "queued") {
    if (ageMs < NEVER_STARTED_MS) return { state: "retryable", reason: "queued", ageMs, attempts };
    return { state: "dead", reason: "never_started", ageMs, attempts };
  }

  if (ageMs < STALE_RUNNING_MS) return { state: "in_flight", reason: "running", ageMs, attempts };
  if (attempts >= MAX_ATTEMPTS) return { state: "dead", reason: "attempts_exhausted", ageMs, attempts };
  if (ageMs >= ABANDONED_MS) return { state: "dead", reason: "worker_stopped", ageMs, attempts };
  return { state: "retryable", reason: "stale_claim", ageMs, attempts };
}

/** The row a dead job becomes. `failed` and not a new status word on purpose:
 *  every surface already knows failed is terminal and draws it as a stop, and a
 *  status nothing recognises would render as "Queued" — a spinner again. The
 *  truthful sentence rides in `result.say`, which describeEditJob prefers. */
function terminalRowFor(row, verdict) {
  const neverRan = verdict.reason === "never_started";
  return {
    job_id: row.job_id,
    site_slug: row.site_slug,
    instruction: row.instruction,
    status: "failed",
    result: {
      error: verdict.reason,
      closed_by: "sweeper",
      attempts: verdict.attempts,
      stale_ms: verdict.ageMs,
      say: neverRan ? NEVER_STARTED_SAY : ABANDONED_SAY,
    },
    updated_at: new Date().toISOString(),
  };
}

/**
 * sweepDeadEditJobs(deps) -> { ok, examined, closed }
 *
 * Cheap by construction — one select and a write per genuinely dead row — so it
 * is safe to hang off a customer-facing request. It never throws: a sweep that
 * failed must not take down the page it was hitching a ride on.
 */
async function sweepDeadEditJobs({
  select,
  upsertRow,
  recordEvent,
  now = Date.now(),
  limit = 25,
  siteSlug = "",
} = {}) {
  if (typeof select !== "function" || typeof upsertRow !== "function") {
    return { ok: false, examined: 0, closed: [], error: "store_unavailable" };
  }
  const scope = siteSlug ? `site_slug=eq.${encodeURIComponent(String(siteSlug).toLowerCase())}&` : "";
  let found;
  try {
    found = await select(
      "ghost_agency_edit_jobs",
      `${scope}or=(status.eq.queued,status.eq.running)&order=created_at.asc&limit=${Math.max(1, Math.min(100, limit))}`,
    );
  } catch (error) {
    return { ok: false, examined: 0, closed: [], error: String((error && error.message) || error).slice(0, 200) };
  }
  const rows = found && found.ok && Array.isArray(found.data) ? found.data : [];
  const closed = [];
  for (const row of rows) {
    const verdict = classifyStuckJob(row, now);
    if (verdict.state !== "dead") continue;
    try {
      await upsertRow("ghost_agency_edit_jobs", terminalRowFor(row, verdict), "job_id");
      closed.push({ jobId: row.job_id, siteSlug: row.site_slug, reason: verdict.reason, staleMs: verdict.ageMs });
      if (typeof recordEvent === "function") {
        await recordEvent("ghost_agency_site_edit_abandoned", {
          jobId: row.job_id,
          siteSlug: row.site_slug,
          reason: verdict.reason,
          staleMs: verdict.ageMs,
          attempts: verdict.attempts,
        }).catch(() => {});
      }
    } catch {
      // One unwritable row must not stop the rest from being told the truth.
    }
  }
  return { ok: true, examined: rows.length, closed };
}

// ---- opportunistic trigger --------------------------------------------------
// The cron is off, so the queue has to heal itself off traffic it already gets.
// Per-instance, so a busy lambda pays for at most one sweep a minute and a cold
// one pays on its first request — which is exactly when a customer has just
// opened the panel onto a job that died.
let lastSweepAt = 0;

/** Reset between tests; also the honest way to force a sweep from an operator
 *  path that genuinely wants one now. */
function resetSweepThrottle() {
  lastSweepAt = 0;
}

async function maybeSweepDeadEditJobs(deps = {}) {
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const interval = Number.isFinite(deps.minIntervalMs) ? deps.minIntervalMs : SWEEP_MIN_INTERVAL_MS;
  if (lastSweepAt && now - lastSweepAt < interval) {
    return { ok: true, skipped: "throttled", examined: 0, closed: [] };
  }
  lastSweepAt = now;
  return sweepDeadEditJobs({ ...deps, now });
}

module.exports = {
  STALE_RUNNING_MS,
  ABANDONED_MS,
  NEVER_STARTED_MS,
  MAX_ATTEMPTS,
  SWEEP_MIN_INTERVAL_MS,
  ABANDONED_SAY,
  NEVER_STARTED_SAY,
  attemptsOf,
  classifyStuckJob,
  terminalRowFor,
  sweepDeadEditJobs,
  maybeSweepDeadEditJobs,
  resetSweepThrottle,
};
