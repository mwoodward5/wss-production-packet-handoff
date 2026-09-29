"use strict";

/**
 * POST /api/admin/rebuild-direct  { prospect_ids: ["id-or-slug", ...], inline? }
 * GET  /api/admin/rebuild-direct?job_id=…                            -> job status
 *
 * WHY THIS EXISTS. /api/admin/rebuild-mirror re-runs ONE prospect's mirror.
 * The day this was written, the operator's only other lever for pushing landed
 * engine fixes (#710-#716) into already-built sites was re-running a campaign
 * over the rebuild cohort — and the Line correctly refused every one of them:
 * re-mining an EXISTING business is indistinguishable from mining a duplicate,
 * so the sandbox identity gate answered `practice_identity_in_prior_history`
 * for all 17. A rebuild is not a new business. It must not re-run intake,
 * identity, or mining, and it must not touch the identity/history tables.
 *
 * This action is the honest lever: for each prospect that ALREADY QUALIFIED,
 * re-run THE MIRROR BUILD ONLY — mirrorProspect(), the exact function the line
 * runner calls after qualification, which compiles from the CURRENT engine and
 * publishes a fresh shared release under the same CAS contracts a first build
 * answers to. Because it compiles fresh, the rebuilt bytes carry today's
 * engine — that is the entire point.
 *
 * IT SENDS NOTHING and WRITES NO IDENTITY: no email, no SMS, no intake row,
 * no mine, no practice-identity claim (the freshness gate is sandbox-lane-only
 * and this action only ever runs the live lane).
 *
 * PATTERNS are rebuild-mirror's: admin-gated, queue-first (durable rows in
 * ghost_agency_rebuild_jobs + fire-and-forget kick + cron sweeper), with an
 * explicit { inline:true } for callers who know the batch is small. Inline
 * batches run at most REBUILD_CONCURRENCY (2) at a time and each build gets
 * the standard INLINE_BUDGET_MS deadline, so one slow deploy cannot eat the
 * whole request.
 *
 * Every successful rebuild records its own durable `mirror.rebuilt` event
 * { prospect_id, build_hash, release_id } for accounting — in the queue lane
 * via lib/rebuild-jobs.js, in the inline lane right here.
 */

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { mirrorProspect } = require("../../lib/line-adapters");
const rebuildJobs = require("../../lib/rebuild-jobs");
const { select, recordEvent } = require("../../lib/store");
const { prospectFromRow } = require("../../lib/prospects");

// One inline batch is a fleet operation, not a bulk import. Cap the list so a
// mistyped payload cannot enqueue a thousand builds in one request.
const MAX_PROSPECTS_PER_CALL = 50;
// The inline lane builds two at a time — the same honest budget the cron
// sweeper uses (DEFAULT_DRAIN_MAX) — and each build gets the same deadline a
// single inline rebuild gets.
const REBUILD_CONCURRENCY = 2;

function requestedMode(body = {}) {
  if (body.queue === true) return "queue";
  if (body.inline === true) return "inline";
  // Queue-first, exactly like rebuild-mirror: the measured ~127s rebuild does
  // not belong inside a request that owes the operator an answer.
  return String(process.env.GHOST_AGENCY_REBUILD_DEFAULT_MODE || "").trim().toLowerCase() === "inline"
    ? "inline"
    : "queue";
}

function inputList(body = {}) {
  const raw = body.prospect_ids || body.prospectIds || body.slugs || [];
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const value = String(entry || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.slice(0, MAX_PROSPECTS_PER_CALL);
}

function releaseIdFromBuild(out = {}) {
  const evidence = out.releaseEvidence && typeof out.releaseEvidence === "object"
    ? out.releaseEvidence
    : out.buildEvidence && typeof out.buildEvidence === "object"
      ? out.buildEvidence.release_evidence
      : null;
  return String(evidence?.proofIdentity?.release_id || evidence?.release_id || "").trim();
}

function createRebuildDirectHandler(overrides = {}) {
  const runMirror = overrides.mirrorProspect || mirrorProspect;
  const readRow = overrides.select || select;
  const record = overrides.recordEvent || recordEvent;
  const jobs = overrides.rebuildJobs || rebuildJobs;
  const kick = overrides.kick
    || ((jobId) => { jobs.runRebuildJob(jobId).catch(() => { /* the sweeper owns failures */ }); });

  async function resolveProspect(input) {
    // Accept the durable prospect_id first, then the site slug — both name the
    // same already-qualified row, and an operator pastes whichever is at hand.
    const byId = await readRow(
      "ghost_agency_prospects",
      `select=*&prospect_id=eq.${encodeURIComponent(input)}&limit=1`,
    ).catch(() => null);
    if (byId?.ok && Array.isArray(byId.data) && byId.data[0]) return byId.data[0];
    const bySlug = await readRow(
      "ghost_agency_prospects",
      `select=*&record->>site_slug=eq.${encodeURIComponent(input)}&limit=1`,
    ).catch(() => null);
    if (bySlug?.ok && Array.isArray(bySlug.data) && bySlug.data[0]) return bySlug.data[0];
    return null;
  }

  async function buildOne({ prospectId, businessName, vertical }) {
    const started = Date.now();
    let out;
    try {
      out = await runMirror(
        { prospectId, businessName, vertical },
        { lane: "live", deadlineAt: Date.now() + rebuildJobs.INLINE_BUDGET_MS },
      );
    } catch (error) {
      out = {
        ok: false,
        reason: `rebuild_direct_error: ${rebuildJobs.safeCode(error?.code || error?.message).slice(0, 120)}`,
      };
    }
    const verdict = {
      ok: out.ok === true,
      prospect_id: prospectId,
      business_name: businessName,
      seconds: Math.round((Date.now() - started) / 1000),
      preview_url: out.previewUrl || "",
      build_hash: out.buildHash || out.build_hash || "",
      release_id: releaseIdFromBuild(out),
      reason: out.ok === true ? "" : String(out.reason || "refused_without_a_reason"),
      terminal: out.terminal || "",
    };
    if (verdict.ok === true) {
      // The rebuild's own accounting event. A rebuild is not a new business:
      // this is the ONLY durable write beyond the build's own release/CAS
      // machinery.
      try {
        await record("mirror.rebuilt", {
          prospect_id: prospectId,
          build_hash: verdict.build_hash,
          release_id: verdict.release_id,
        });
      } catch { /* the log is observability, never a dependency */ }
    }
    return verdict;
  }

  // At most REBUILD_CONCURRENCY builds at once: one slow deploy must not hold
  // the whole cohort behind it, and two concurrent deploys are the same budget
  // the cron sweeper already proved safe.
  async function buildAll(items) {
    const verdicts = new Array(items.length);
    let cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        verdicts[index] = await buildOne(items[index]);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(REBUILD_CONCURRENCY, items.length) }, worker),
    );
    return verdicts;
  }

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
      const inputs = inputList(body);
      if (!inputs.length) {
        sendJson(res, 400, {
          ok: false,
          error: "prospect_ids_required",
          hint: `array of prospect ids or site slugs, max ${MAX_PROSPECTS_PER_CALL} per call`,
        });
        return;
      }

      // Resolve every entry BEFORE anything runs: one honest error per unknown
      // input, and never a half-cohort build because entry 7 was a typo.
      const resolved = [];
      const unknown = [];
      for (const input of inputs) {
        const row = await resolveProspect(input);
        if (!row) {
          unknown.push({ input, error: "prospect_not_found" });
          continue;
        }
        const prospect = prospectFromRow(row) || {};
        resolved.push({
          input,
          prospectId: String(row.prospect_id || prospect.prospectId || ""),
          businessName: String(prospect.business_name || row.business_name || ""),
          vertical: String(prospect.industry || row.industry || ""),
        });
      }

      if (!resolved.length) {
        sendJson(res, 404, { ok: false, error: "no_resolvable_prospects", unknown });
        return;
      }

      if (requestedMode(body) === "queue") {
        // One durable row per prospect, kicked the way rebuild-mirror kicks:
        // the row is the promise, the sweeper drains what a frozen kick leaves.
        const enqueued = [];
        const failed = [];
        for (const item of resolved) {
          const job = await jobs.enqueueRebuildJob({ prospectId: item.prospectId, actor: "rebuild_direct" });
          if (!job.ok) {
            failed.push({ prospect_id: item.prospectId, error: job.error });
            continue;
          }
          kick(job.jobId);
          enqueued.push({
            ok: true,
            prospect_id: item.prospectId,
            business_name: item.businessName,
            job_id: job.jobId,
            reused: job.reused === true,
          });
        }
        sendJson(res, enqueued.length ? 202 : 503, {
          ok: enqueued.length > 0,
          queued: enqueued.length > 0,
          queued_count: enqueued.length,
          jobs: enqueued,
          failed,
          unknown,
          poll: { method: "GET", path: "/api/admin/rebuild-direct?job_id=…" },
        });
        return;
      }

      const verdicts = await buildAll(resolved);
      sendJson(res, 200, {
        ok: verdicts.every((v) => v.ok === true),
        rebuilt: verdicts.filter((v) => v.ok === true).length,
        refused: verdicts.filter((v) => v.ok !== true).length,
        results: verdicts,
        unknown,
      });
    } catch (error) {
      handleError(res, error, "rebuild_direct_failed");
    }
  };
}

const handler = createRebuildDirectHandler();

module.exports = handler;
module.exports.handler = handler;
module.exports.createRebuildDirectHandler = createRebuildDirectHandler;
module.exports.requestedMode = requestedMode;
module.exports.inputList = inputList;
module.exports.REBUILD_CONCURRENCY = REBUILD_CONCURRENCY;
module.exports.MAX_PROSPECTS_PER_CALL = MAX_PROSPECTS_PER_CALL;
