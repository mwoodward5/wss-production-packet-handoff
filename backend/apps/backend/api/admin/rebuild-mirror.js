"use strict";

/**
 * POST /api/admin/rebuild-mirror  { prospect_id }          -> queued or inline
 * GET  /api/admin/rebuild-mirror?job_id=…                  -> job status
 *
 * WHY THIS EXISTS. A fix that lands in code does not reach a customer's page
 * until that page is built AGAIN — the pattern that has now cost this project
 * two separate days. There was no operator route that could do it:
 *
 *   · /api/admin/build-preview runs buildPreviewForProspect, whose FIRST gate
 *     is recorded_positive_preview_consent_required. Every mirror the Line has
 *     ever built answers `held / consent_not_verified` there, because the Line
 *     never wrote that field — deliberately. lib/line-adapters.js says why, in
 *     its own words: "A mirror is an owner-funded spec build on our
 *     infrastructure. Prospect consent belongs at the outreach boundary, never
 *     at build/render/write." So the consent gate is not wrong; it simply
 *     guards a different lane, and using it to rebuild would have meant either
 *     bypassing a consent check or writing consent nobody gave.
 *
 *   · /api/admin/line start MINES NEW LEADS. It cannot re-run an existing one.
 *
 * So this route re-runs the LINE's own build path for a prospect that already
 * has one — mirrorProspect(), the same function the line runner calls, with
 * the same contract checks, the same donor resolution and the same host guard.
 *
 * IT SENDS NOTHING. No email, no SMS, no approval. It rebuilds and redeploys
 * the mirror at its existing slug and hands back the verdict verbatim: a
 * refusal keeps its own sentence rather than being flattened into "failed",
 * because "the vertical gate refused this multi-trade business" and "the build
 * crashed" are different facts and an operator needs to tell them apart.
 *
 * WHY IT NO LONGER BUILDS INSIDE THE REQUEST (2026-08-17). A rebuild IS a
 * build — measured build+deploy is ~127s — and that day a live rebuild
 * deployed successfully while its response died at Vercel's 300s
 * FUNCTION_INVOCATION_TIMEOUT: the work survived, the answer was lost, and the
 * operator got a 504 for a site that was actually live. Same disease the
 * Mines had before the durable line worker; same cure:
 *
 *   · The DEFAULT is the durable queue: one row in ghost_agency_rebuild_jobs,
 *     an immediate { ok:true, queued:true, jobId }, and a fire-and-forget kick
 *     that starts the build in the SAME lambda. The atomic claim in
 *     lib/rebuild-jobs.js makes a frozen kick and the every-2-minutes sweeper
 *     (api/cron/run-rebuild-mirror-jobs) safe against each other, so the fast
 *     ack is honest, not optimistic.
 *   · A caller who KNOWS the build is small can still run it inline and get
 *     today's synchronous verdict: pass { inline:true }. The measured comfort
 *     line is ~120s (see lib/rebuild-jobs INLINE_BUDGET_MS); a fleet whose
 *     rebuilds sit comfortably under it can flip the default with
 *     GHOST_AGENCY_REBUILD_DEFAULT_MODE=inline.
 *
 * Auth is unchanged: admin-gated on both methods, exactly as before.
 */

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { mirrorProspect } = require("../../lib/line-adapters");
const rebuildJobs = require("../../lib/rebuild-jobs");
const { select } = require("../../lib/store");
const { prospectFromRow } = require("../../lib/prospects");

const DEFAULT_MODE_ENV = "GHOST_AGENCY_REBUILD_DEFAULT_MODE";

function requestedMode(body = {}) {
  if (body.queue === true) return "queue";
  if (body.inline === true) return "inline";
  // Default queue-first: the measured ~127s rebuild does not fit comfortably
  // inside a request that owes the operator an answer, and the live 504 is the
  // proof. The env knob flips the default for a measured-fast fleet.
  return String(process.env[DEFAULT_MODE_ENV] || "").trim().toLowerCase() === "inline"
    ? "inline"
    : "queue";
}

function createRebuildMirrorHandler(overrides = {}) {
  const runMirror = overrides.mirrorProspect || mirrorProspect;
  const readRow = overrides.select || select;
  const jobs = overrides.rebuildJobs || rebuildJobs;
  // The kick is injectable so a test can observe the fire-and-forget start
  // without racing real timers. Production gets the real worker call.
  const kick = overrides.kick
    || ((jobId) => { jobs.runRebuildJob(jobId).catch(() => { /* the sweeper owns failures */ }); });
  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET", "POST"])) return;
    if (!requireAdmin(req, res)) return;
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", "http://localhost");
        const jobId = String(url.searchParams.get("job_id") || "").trim();
        if (!jobId) {
          sendJson(res, 400, { ok: false, error: "job_id_required" });
          return;
        }
        const found = await jobs.getRebuildJob(jobId);
        if (!found.ok) {
          const status = found.error === "unknown_job" ? 404 : 503;
          sendJson(res, status, { ok: false, error: found.error, job_id: jobId });
          return;
        }
        sendJson(res, 200, rebuildJobs.publicVerdict(found.job));
        return;
      }

      const body = await readJson(req).catch(() => ({}));
      const prospectId = String(body.prospect_id || body.prospectId || "").trim();
      if (!prospectId) {
        sendJson(res, 400, { ok: false, error: "missing_prospect_id" });
        return;
      }

      // Read the row first so the response can name the business even when the
      // build refuses — an operator scanning a hundred verdicts needs the name.
      const found = await readRow(
        "ghost_agency_prospects",
        `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      ).catch(() => null);
      const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
      if (!row) {
        sendJson(res, 404, { ok: false, error: "prospect_not_found", prospect_id: prospectId });
        return;
      }
      const prospect = prospectFromRow(row) || {};
      const businessName = prospect.business_name || row.business_name || "";

      if (requestedMode(body) === "queue") {
        const enqueued = await jobs.enqueueRebuildJob({ prospectId, actor: "operator" });
        if (!enqueued.ok) {
          // Honest refusal. Falling back to a ~127s inline build from here
          // would reintroduce the exact 504 this queue exists to end.
          sendJson(res, 503, { ok: false, error: enqueued.error, prospect_id: prospectId });
          return;
        }
        // DURABLY QUEUED, THEN KICKED, NEVER AWAITED. The row is the promise;
        // the kick is best-effort by design — a serverless instance may freeze
        // the moment res.end runs, and that is fine: the claim is atomic, the
        // cron sweeper drains what a frozen kick leaves, and a stale "running"
        // claim is reclaimed after STALE_RUNNING_MS. Durability was never this
        // response's to carry.
        kick(enqueued.jobId);
        sendJson(res, 202, {
          ok: true,
          queued: true,
          jobId: enqueued.jobId,
          job_id: enqueued.jobId,
          prospect_id: prospectId,
          business_name: businessName,
          status: "queued",
          poll: { method: "GET", path: `/api/admin/rebuild-mirror?job_id=${encodeURIComponent(enqueued.jobId)}` },
        });
        return;
      }

      const started = Date.now();
      const out = await runMirror(
        { prospectId, businessName, vertical: prospect.industry || row.industry || "" },
        { lane: "live" },
      );

      sendJson(res, 200, {
        ok: out.ok === true,
        prospect_id: prospectId,
        business_name: businessName,
        seconds: Math.round((Date.now() - started) / 1000),
        preview_url: out.previewUrl || "",
        build_hash: out.buildHash || "",
        // The refusal in the words the lane wrote, never a summary of them.
        reason: out.ok === true ? "" : String(out.reason || "refused_without_a_reason"),
        terminal: out.terminal || "",
      });
    } catch (error) {
      handleError(res, error, "rebuild_mirror_failed");
    }
  };
}

const handler = createRebuildMirrorHandler();

module.exports = handler;
module.exports.handler = handler;
module.exports.createRebuildMirrorHandler = createRebuildMirrorHandler;
module.exports.requestedMode = requestedMode;
