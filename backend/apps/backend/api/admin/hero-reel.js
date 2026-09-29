"use strict";

/**
 * POST /api/admin/hero-reel  { prospect_id, producer? }         -> enqueue one
 *                                                                  durable WAN
 *                                                                  or Ads job
 * POST /api/admin/hero-reel  { job_id, action, lease_token,
 *                               verdict }                        -> settle/requeue
 * POST /api/admin/hero-reel  { job_id, action:"renew", lease_token,
 *                               worker_id, lease_ms? }            -> heartbeat lease
 * POST /api/admin/hero-reel  { job_id, action:"checkpoint", lease_token,
 *                               checkpoint }                     -> persist paid-provider state
 * POST /api/admin/hero-reel  { job_id, action:"approve",
 *                               clip_sha256, approved_by,
 *                               approved_at }                    -> owner approval
 * GET  /api/admin/hero-reel?next=1&worker_id=…&producer=…       -> lease one
 *                                                                  producer's job
 * POST /api/admin/hero-reel  { prospect_id, producer:"hero_compose_local", force? }
 *                                                               -> the legacy
 *                                                                  ffmpeg compose
 * GET  /api/admin/hero-reel?job_id=…                            -> job status
 * GET  /api/admin/hero-reel?prospect_id=…                       -> current reel state
 *
 * WHY THIS EXISTS. The couture hero rung's consume side has been finished for
 * weeks — heroReelBlock, brand-assets, the engine slot, all 13 donor ladders —
 * but NOTHING ever wrote record.media_bank.hero_reel, so every mirror rode the
 * donor's shared fallback clip. This route is the operator's button for the
 * producer side.
 *
 * WHAT THE DEFAULT PRODUCER IS NOW, AND WHY. The shared hero-video policy picks
 * local WAN for a supported prospect vertical. Ads remains the durable fallback
 * when WAN-primary is explicitly off or the row's vertical is missing/outside
 * the WAN prompt pack. Either durable producer may be named explicitly. The
 * retired ffmpeg slideshow remains one POST away only when the operator asks for
 * `producer:"hero_compose_local"` by name.
 *
 * WHY THE DURABLE LANES ARE ENQUEUE/LEASE AND THE COMPOSE LANE IS NOT. WAN and
 * Ads generation belong to their workers. Vercel records the request; a worker
 * claims it with an expiring token. No serverless request starts generation or
 * imports a browser.
 *
 * WHERE EACH LANE ACTUALLY WORKS. WAN runs on the local WAN worker and Ads runs
 * on the signed-in desktop worker. ffmpeg is not in the Vercel runtime
 * (lib/hero-compose.js:82-96 documents that in blood). Serverless does
 * queue/state work only.
 *
 * IT SENDS NOTHING. No email, no SMS. A completed durable job queues a mirror
 * rebuild once its clip is on the record; that rebuild sends nothing either.
 */

const { adminAllowed, requireAdmin } = require("../../lib/admin-auth");
const { heroWorkerAllowed, requireHeroWorker } = require("../../lib/hero-worker-auth");
const { handleError, methodGuard, sendJson, readJson } = require("../../lib/http");
const runner = require("../../lib/hero-reel-runner");
const heroReelJobs = require("../../lib/hero-reel-job-queue");
const {
  ADS_PRODUCER,
  OPENROUTER_SEEDANCE_PRODUCER,
  LEGACY_COMPOSE_PRODUCER,
  DURABLE_HERO_PRODUCERS,
  defaultHeroProducer,
  isDurableHeroProducer,
  resolveHeroProducer,
} = require("../../lib/hero-video-policy");
const { select } = require("../../lib/store");
const { firstValue, prospectFromRow } = require("../../lib/prospects");

const LEGACY_PRODUCER = LEGACY_COMPOSE_PRODUCER;

function rowVertical(row = {}, prospect = {}) {
  const record = row.record && typeof row.record === "object" ? row.record : {};
  const buildReady = record.build_ready && typeof record.build_ready === "object"
    ? record.build_ready
    : {};
  const request = buildReady.mirror_request && typeof buildReady.mirror_request === "object"
    ? buildReady.mirror_request
    : {};
  const facts = request.facts && typeof request.facts === "object" ? request.facts : {};
  const mirrorRequest = record.mirror_request && typeof record.mirror_request === "object"
    ? record.mirror_request
    : {};
  const mirrorFacts = mirrorRequest.facts && typeof mirrorRequest.facts === "object"
    ? mirrorRequest.facts
    : {};
  const truthCategory = prospect?.truth_packet?.identity?.category?.value
    || record?.truth_packet?.identity?.category?.value
    || "";
  const keys = ["industry", "category", "primary_type", "vertical"];
  return firstValue(prospect, keys)
    || firstValue(record, keys)
    || firstValue(facts, keys)
    || firstValue(mirrorFacts, keys)
    || String(truthCategory).trim();
}

function createHeroReelHandler(overrides = {}) {
  const ensureReel = overrides.ensureHeroReel || runner.ensureHeroReel;
  const patchReel = overrides.patchHeroReel || runner.patchHeroReel;
  const policyEnv = overrides.env || process.env;
  // The old override names stay accepted so focused route tests and callers
  // can cross this deployment without a flag day.
  const startHeroJob = overrides.enqueueHeroReelJob
    || overrides.startHeroReel
    || heroReelJobs.enqueueHeroReelJob;
  const readHeroJob = overrides.getHeroReelJob || heroReelJobs.getHeroReelJob;
  const readProspectJob = overrides.getHeroReelJobForProspect
    || heroReelJobs.getHeroReelJobForProspect;
  const claimHeroJob = overrides.claimNextHeroReelJob || heroReelJobs.claimNextHeroReelJob;
  const settleHeroJob = overrides.settleHeroReelJob || heroReelJobs.settleHeroReelJob;
  const renewHeroJob = overrides.renewHeroReelJobLease || heroReelJobs.renewHeroReelJobLease;
  const checkpointHeroJob = overrides.checkpointHeroReelJob || heroReelJobs.checkpointHeroReelJob;
  const approveHeroJob = overrides.approveHeroReelJob || heroReelJobs.approveHeroReelJob;
  const reviewHeroJob = overrides.reviewHeroReelJob || heroReelJobs.reviewHeroReelJob;
  const readRow = overrides.select || select;

  async function loadRow(prospectId) {
    const found = await readRow(
      "ghost_agency_prospects",
      `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    ).catch(() => null);
    return found?.ok && Array.isArray(found.data) ? found.data[0] : null;
  }

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET", "POST"])) return;
    try {
      if (req.method === "GET") {
        const url = new URL(req.url || "/", "http://localhost");

        if (url.searchParams.get("next") === "1") {
          if (!requireHeroWorker(req, res)) return;
          const workerId = String(url.searchParams.get("worker_id") || "").trim();
          if (!workerId) {
            sendJson(res, 400, { ok: false, error: "worker_id_required" });
            return;
          }
          // Old Ads workers did not send a producer. Keep that caller safe by
          // making its old request explicitly Ads-scoped; never let a missing
          // query turn into the policy's WAN code-default.
          const requestedProducer = String(url.searchParams.get("producer") || "").trim();
          const producer = resolveHeroProducer(requestedProducer || ADS_PRODUCER, {
            env: policyEnv,
            explicit: true,
          });
          if (!isDurableHeroProducer(producer)) {
            sendJson(res, 400, {
              ok: false,
              error: "unknown_producer",
              producer: requestedProducer,
              allowed: [...DURABLE_HERO_PRODUCERS],
            });
            return;
          }
          if (producer === OPENROUTER_SEEDANCE_PRODUCER) {
            sendJson(res, 403, { ok: false, error: "seedance_capability_required" });
            return;
          }
          const claimed = await claimHeroJob({ workerId, producer });
          if (!claimed || claimed.ok !== true) {
            sendJson(res, 503, {
              ok: false,
              error: String(claimed?.error || "hero_reel_queue_unavailable"),
            });
            return;
          }
          sendJson(res, 200, claimed);
          return;
        }

        if (!requireAdmin(req, res)) return;

        // job_id answers first: it is the poll for a started durable job, and
        // it needs no prospect row at all.
        const jobId = String(url.searchParams.get("job_id") || "").trim();
        if (jobId) {
          const verdict = await readHeroJob(jobId);
          if (!verdict || verdict.error === "unknown_job") {
            sendJson(res, 404, { ok: false, error: "unknown_job", job_id: jobId });
            return;
          }
          if (verdict.ok !== true && verdict.error) {
            sendJson(res, 503, { ok: false, error: verdict.error, job_id: jobId });
            return;
          }
          // Durable store methods return {ok,job}; old injected tests return
          // the already-public verdict. Accept both during the cut-over.
          sendJson(res, 200, verdict.job
            ? { ok: true, ...heroReelJobs.publicJob(verdict.job) }
            : verdict);
          return;
        }

        const prospectId = String(url.searchParams.get("prospect_id") || "").trim();
        if (!prospectId) {
          sendJson(res, 400, { ok: false, error: "prospect_id_required" });
          return;
        }
        const row = await loadRow(prospectId);
        if (!row) {
          sendJson(res, 404, { ok: false, error: "prospect_not_found", prospect_id: prospectId });
          return;
        }
        const prospect = prospectFromRow(row) || {};
        const reel = row.record?.media_bank?.hero_reel || null;
        const queued = await readProspectJob(prospectId).catch(() => null);
        sendJson(res, 200, {
          ok: true,
          prospect_id: prospectId,
          business_name: prospect.business_name || row.business_name || "",
          hero_reel: reel,
          // The one question an operator is actually asking: will the NEXT
          // build put this on the hero? Same three gates heroReelBlock applies.
          rides: runner.reelEarnsTheRide(reel),
          hero_reel_job: queued?.ok && queued.job ? heroReelJobs.publicJob(queued.job) : null,
        });
        return;
      }

      // Reject strangers before attaching body listeners or allocating JSON.
      // The exact owner-vs-worker capability is enforced again after action is
      // known; this preflight only establishes that one trusted lane is present.
      const preflightAdmin = adminAllowed(req);
      const preflightWorker = heroWorkerAllowed(req);
      if (!preflightAdmin.allowed && !preflightWorker.allowed) {
        sendJson(res, preflightAdmin.configured || preflightWorker.configured ? 401 : 503, {
          ok: false,
          error: preflightAdmin.configured || preflightWorker.configured
            ? "unauthorized"
            : "server_auth_unconfigured",
        });
        return;
      }
      const body = await readJson(req).catch(() => ({}));

      // Desktop worker callback. It cannot change a row unless the exact
      // unexpired lease it received from GET ?next=1 still owns that row.
      const settlementJobId = String(body.job_id || body.jobId || "").trim();
      const action = String(body.action || "").trim().toLowerCase();
      const ownerReviewAction = ["approve", "reject", "regenerate"].includes(action);
      if (settlementJobId && !ownerReviewAction) {
        if (!requireHeroWorker(req, res)) return;
      } else if (!requireAdmin(req, res)) return;
      if (settlementJobId) {
        if (action === "renew") {
          const renewed = await renewHeroJob({
            jobId: settlementJobId,
            leaseToken: body.lease_token || body.leaseToken,
            workerId: body.worker_id || body.workerId,
            leaseMs: body.lease_ms || body.leaseMs,
          });
          if (!renewed || renewed.ok !== true) {
            const error = String(renewed?.error || "hero_reel_queue_unavailable");
            const status = error === "unknown_job"
              ? 404
              : error === "lease_conflict"
                ? 409
                : ["job_id_required", "lease_token_required", "worker_id_required"].includes(error)
                  ? 400
                  : 503;
            sendJson(res, status, {
              ok: false,
              error,
              job_id: settlementJobId,
              ...(renewed?.status ? { status: renewed.status } : {}),
            });
            return;
          }
          sendJson(res, 200, renewed);
          return;
        }
        if (action === "checkpoint") {
          const checkpointed = await checkpointHeroJob({
            jobId: settlementJobId,
            leaseToken: body.lease_token || body.leaseToken,
            checkpoint: body.checkpoint,
          });
          if (!checkpointed || checkpointed.ok !== true) {
            const error = String(checkpointed?.error || "hero_reel_queue_unavailable");
            const status = error === "unknown_job"
              ? 404
              : ["lease_conflict", "seedance_provider_checkpoint_conflict"].includes(error)
                ? 409
                : ["job_id_required", "lease_token_required", "seedance_provider_checkpoint_invalid"].includes(error)
                  ? 400
                  : 503;
            sendJson(res, status, { ok: false, error, job_id: settlementJobId });
            return;
          }
          sendJson(res, 200, checkpointed);
          return;
        }
        if (action === "approve") {
          const approved = await approveHeroJob({
            jobId: settlementJobId,
            clipSha256: body.clip_sha256 || body.clipSha256,
            generationRevision: body.generation_revision || body.generationRevision,
            approvedBy: body.approved_by || body.approvedBy,
            approvedAt: body.approved_at || body.approvedAt,
          });
          if (!approved || approved.ok !== true) {
            const error = String(approved?.error || "hero_reel_queue_unavailable");
            const status = error === "unknown_job"
              ? 404
              : ["approval_state_conflict", "approval_sha_mismatch", "approval_revision_mismatch", "approval_artifact_invalid"].includes(error)
                ? 409
                : ["job_id_required", "clip_sha256_required", "generation_revision_required", "approved_by_required", "approved_at_invalid"].includes(error)
                  ? 400
                  : 503;
            sendJson(res, status, {
              ok: false,
              error,
              job_id: settlementJobId,
              ...(approved?.status ? { status: approved.status } : {}),
              ...(approved?.detail ? { detail: approved.detail } : {}),
            });
            return;
          }
          sendJson(res, 200, approved);
          return;
        }
        if (["reject", "regenerate"].includes(action)) {
          const reviewed = await reviewHeroJob({
            jobId: settlementJobId,
            action,
            reason: body.reason,
            reviewedBy: body.reviewed_by || body.reviewedBy || body.approved_by || body.approvedBy,
          });
          if (!reviewed || reviewed.ok !== true) {
            const error = String(reviewed?.error || "hero_reel_queue_unavailable");
            const status = error === "unknown_job"
              ? 404
              : error === "review_state_conflict"
                ? 409
                : ["job_id_required", "invalid_review_action", "reviewed_by_required", "review_reason_required"].includes(error)
                  ? 400
                  : 503;
            sendJson(res, status, {
              ok: false,
              error,
              job_id: settlementJobId,
              ...(reviewed?.status ? { status: reviewed.status } : {}),
              ...(reviewed?.allowed ? { allowed: reviewed.allowed } : {}),
            });
            return;
          }
          sendJson(res, 200, reviewed);
          return;
        }
        const settled = await settleHeroJob({
          jobId: settlementJobId,
          action,
          leaseToken: body.lease_token || body.leaseToken,
          verdict: body.verdict,
        });
        if (!settled || settled.ok !== true) {
          const error = String(settled?.error || "hero_reel_queue_unavailable");
          const status = error === "unknown_job"
            ? 404
            : [
              "lease_conflict",
              "approval_required",
              "approved_clip_sha_mismatch",
              "generation_revision_mismatch",
              "completion_requires_verified_upload",
            ].includes(error)
              ? 409
              : ["job_id_required", "lease_token_required", "invalid_action"].includes(error)
                || error.startsWith("invalid_")
                || error.startsWith("optimized_asset_")
                || ["noncanonical_remaster_prompt", "source_photo_provenance_mismatch"].includes(error)
                ? 400
                : 503;
          sendJson(res, status, {
            ok: false,
            error,
            job_id: settlementJobId,
            ...(settled?.allowed ? { allowed: settled.allowed } : {}),
            ...(settled?.status ? { status: settled.status } : {}),
          });
          return;
        }
        sendJson(res, 200, settled);
        return;
      }

      const prospectId = String(body.prospect_id || body.prospectId || "").trim();
      if (!prospectId) {
        sendJson(res, 400, { ok: false, error: "missing_prospect_id" });
        return;
      }
      const row = await loadRow(prospectId);
      if (!row) {
        sendJson(res, 404, { ok: false, error: "prospect_not_found", prospect_id: prospectId });
        return;
      }
      const prospect = prospectFromRow(row) || {};
      const businessName = prospect.business_name || row.business_name || "";
      const requestedProducer = String(body.producer || body.generator || "").trim();
      const vertical = rowVertical(row, prospect);
      const producer = requestedProducer
        ? resolveHeroProducer(requestedProducer, { env: policyEnv, explicit: true })
        : vertical
          ? defaultHeroProducer(policyEnv, vertical)
          : ADS_PRODUCER;

      if (!producer) {
        sendJson(res, 400, {
          ok: false,
          error: "unknown_producer",
          producer: requestedProducer,
          allowed: [...DURABLE_HERO_PRODUCERS, LEGACY_PRODUCER],
        });
        return;
      }

      if (isDurableHeroProducer(producer)) {
        // ENQUEUE AND RETURN. WAN and Ads belong to their workers; this
        // serverless route never starts a browser or awaits generation.
        const startedJob = await startHeroJob(row, {
          actor: "operator",
          producer,
          vertical,
          env: policyEnv,
          retry: body.retry === true,
          adsParams: body.ads_params || body.adsParams,
          allowUnverifiedLength: body.allow_unverified_length === true,
          uploadFallbackFiles: Array.isArray(body.upload_fallback_files) ? body.upload_fallback_files : [],
        });
        if (!startedJob || startedJob.ok !== true) {
          // The coordinator's refusal in ITS own words. "no_legacy_site_url"
          // (wrong lead), "station_unavailable" (wrong host) and
          // "prospect_already_claimed" (someone else is already on it) are
          // three different facts and an operator needs to tell them apart.
          sendJson(res, startedJob?.error ? 503 : 200, {
            ok: false,
            prospect_id: prospectId,
            business_name: businessName,
            producer,
            reason: String((startedJob && (startedJob.reason || startedJob.error)) || "refused_without_a_reason"),
            ...(startedJob && startedJob.error ? { error: startedJob.error } : {}),
            ...(startedJob && startedJob.detail ? { detail: startedJob.detail } : {}),
            ...(startedJob && startedJob.job_id ? { job_id: startedJob.job_id } : {}),
          });
          return;
        }
        const status = startedJob.status || "queued";
        const queued = startedJob.queued === true || status === "queued";
        const effectiveProducer = String(startedJob.producer || producer).trim();
        sendJson(res, queued ? 202 : 200, {
          ok: true,
          queued,
          prospect_id: prospectId,
          business_name: businessName,
          producer: effectiveProducer,
          job_id: startedJob.job_id,
          jobId: startedJob.job_id,
          status,
          reused: startedJob.reused === true,
          source_url: startedJob.source_url || "",
          source_from: startedJob.source_from || "",
          poll: startedJob.poll
            || { method: "GET", path: `/api/admin/hero-reel?job_id=${encodeURIComponent(startedJob.job_id)}` },
        });
        return;
      }

      // ---- the explicit opt-in: the retired ffmpeg slideshow ----------------
      // Reachable only by naming it. Same synchronous contract it always had.
      const started = Date.now();
      const made = await ensureReel(row, { force: body.force === true });
      if (!made || made.ok !== true) {
        // The runner's refusal in its own words — "ffmpeg_unavailable" and
        // "need_at_least_two_photos" are different facts and an operator needs
        // to tell them apart (one says "wrong host", the other "wrong lead").
        sendJson(res, 200, {
          ok: false,
          prospect_id: prospectId,
          business_name: businessName,
          producer,
          reason: String((made && made.reason) || "refused_without_a_reason"),
          ...(made && made.detail ? { detail: made.detail } : {}),
        });
        return;
      }

      // A reused reel is already on the record; re-patching it would only
      // touch updated_at for nothing.
      const patched = made.reused === true
        ? { ok: true, reused: true }
        : await patchReel(prospectId, made);
      sendJson(res, 200, {
        ok: patched.ok === true,
        prospect_id: prospectId,
        business_name: businessName,
        url: made.url,
        composed_from: made.composed_from,
        generator: made.generator,
        ...(made.bytes ? { bytes: made.bytes } : {}),
        ...(made.reused ? { reused: true } : {}),
        patched: patched.ok === true && made.reused !== true,
        seconds: Math.round((Date.now() - started) / 1000),
        // A composed-but-unpatched reel is not silent: the upload happened,
        // the record write did not, and the reason says why.
        ...(patched.ok !== true ? { reason: `patch_failed:${String(patched.reason || "")}` } : {}),
      });
    } catch (error) {
      handleError(res, error, "hero_reel_failed");
    }
  };
}

const handler = createHeroReelHandler();

module.exports = handler;
module.exports.handler = handler;
module.exports.createHeroReelHandler = createHeroReelHandler;
