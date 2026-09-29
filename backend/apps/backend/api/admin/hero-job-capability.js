"use strict";

const { randomUUID } = require("node:crypto");
const { requireAdmin, adminAllowed } = require("../../lib/admin-auth");
const {
  heroWorkerAuthState,
  requestWorkerToken,
  safeTokenEqual,
} = require("../../lib/hero-worker-auth");
const { select, conditionalUpdate } = require("../../lib/store");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const queue = require("../../lib/hero-reel-job-queue");
const { normalizeLineHandle } = require("../../lib/line-hero-wakeup");
const {
  HERO_JOB_CAPABILITY_LAUNCH_SCHEMA,
  heroJobCapabilityRedemptionSha256,
  newHeroJobCapabilityClaims,
  requestHeroJobCapability,
  requestHeroJobLease,
  signHeroJobCapability,
  verifyHeroJobCapability,
} = require("../../lib/hero-job-capability");
const { OPENROUTER_SEEDANCE_PRODUCER } = require("../../lib/hero-video-policy");

const MINT_FIELDS = Object.freeze(["action", "phase", "job_id", "prospect_id"]);
const LEASE_SETTLE_OUTCOMES = new Set(["hold", "requeue", "fail", "refuse"]);

async function nextQueuedSeedanceJob(deps = {}, scope = {}) {
  const readTable = deps.select || select;
  const retire = deps.conditionalUpdate || conditionalUpdate;
  // The worker route passes the per-request probe in the selector scope. Keep
  // the dependency form for direct callers, but prefer the request-bound
  // probe so the scan validates and skips stale candidates before returning.
  const mintProbe = typeof scope.mintProbe === "function" ? scope.mintProbe : deps.mintProbe;
  const now = deps.now instanceof Date ? deps.now : (typeof deps.now === "function" ? deps.now() : new Date());
  const env = deps.env || process.env;
  const practiceBatchId = clean(scope.practiceBatchId || deps.practiceBatchId);
  const practiceRowId = clean(scope.practiceRowId || deps.practiceRowId);
  const practiceScoped = scope.practice === true || deps.practice === true;
  if (practiceScoped && (!practiceBatchId || !practiceRowId)) {
    return { ok: false, error: "practice_target_required" };
  }
  // The broker mints for ONE candidate per wave. A small oldest-first window
  // with no parent gate let queued jobs from durably halted campaigns occupy
  // it forever: every mint failed parent_line_batch_halted, the whole worker
  // wave errored, and fresh batches' heroes sat unclaimed for hours (measured
  // live 2026-08-29). Scan deeper, skip dead-parent candidates, and report an
  // idle wave — never a hard error — when every scanned candidate is dead.
  const exactPracticeFilter = practiceScoped
    ? `&payload->line_handle->>batchId=eq.${encodeURIComponent(practiceBatchId)}&payload->line_handle->>rowId=eq.${encodeURIComponent(practiceRowId)}`
    : "";
  const query = `?select=*&status=eq.queued&producer=eq.${OPENROUTER_SEEDANCE_PRODUCER}&lease_token=is.null${exactPracticeFilter}&order=created_at.asc&limit=${practiceScoped ? 2 : 50}`;
  const found = await readTable(queue.HERO_REEL_JOBS_TABLE, query).catch(() => null);
  if (!found?.ok || !Array.isArray(found.data)) return { ok: false, error: "hero_reel_queue_unavailable" };
  for (const raw of found.data) {
    const job = queue.jobFromRow(raw);
    if (!job?.jobId || job.producer !== OPENROUTER_SEEDANCE_PRODUCER) continue;
    const handle = job.payload?.line_handle;
    const batchId = handle && typeof handle === "object" ? String(handle.batchId || "").trim() : "";
    const rowId = handle && typeof handle === "object" ? String(handle.rowId || "").trim() : "";
    if (practiceScoped && (batchId !== practiceBatchId || rowId !== practiceRowId)) continue;
    let parentRead = null;
    if (batchId) {
      parentRead = await readTable(
        "ghost_agency_line_batches",
        `?select=status,lane&batch_id=eq.${encodeURIComponent(batchId)}&limit=1`,
      ).catch(() => null);
      if (practiceScoped) {
        if (!parentRead?.ok || !Array.isArray(parentRead.data)) {
          return { ok: false, error: "practice_parent_unavailable" };
        }
        if (!parentRead.data.length) return { ok: false, error: "practice_parent_missing" };
        if (String(parentRead.data[0]?.lane || "") !== "sandbox") {
          return { ok: false, error: "practice_target_not_sandbox" };
        }
        if (String(parentRead.data[0]?.status || "") === "halted") return { ok: true, job: null };
      }
      // An unreadable parent stays the mint's problem (the grant re-checks the
      // gate durably). A MISSING or durably halted parent (#487: halt is
      // terminal) is a dead candidate: retire it from the queued pool — it can
      // never be claimed, and leaving it queued starves every scan window.
      // The CAS (still queued, still unleased) makes the retirement idempotent
      // and safe against a racing mint.
      if (parentRead?.ok && Array.isArray(parentRead.data)) {
        if (!parentRead.data.length || String(parentRead.data[0]?.status || "") === "halted") {
          await retire(
            queue.HERO_REEL_JOBS_TABLE,
            "job_id",
            job.jobId,
            {
              status: "eq.queued",
              producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
              lease_token: "is.null",
            },
            {
              status: "failed",
              result: {
                ok: false,
                reason: "parent_line_batch_halted",
                action: "fail",
                settled_at: new Date().toISOString(),
              },
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ).catch(() => null);
          continue;
        }
      }
    }
    // Expired accepted-provider budget (#490 family): a paid submit whose
    // acceptance window closed can never complete — retire it here so it
    // cannot occupy the scan window.
    const approvedSha = queue.exactApprovedClipSha(job);
    const acceptedBudget = approvedSha ? { ok: true } : queue.acceptedSeedanceJobBudget(job, { env, now });
    if (!acceptedBudget.ok) {
      const at = now.toISOString();
      const checkpoint = job.result?.provider_checkpoint || {};
      await retire(
        queue.HERO_REEL_JOBS_TABLE,
        "job_id",
        job.jobId,
        {
          status: "eq.queued",
          producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
          lease_token: "is.null",
          attempts: `eq.${job.attempts}`,
          ...(job.updatedAt ? { updated_at: `eq.${job.updatedAt}` } : {}),
          "result->provider_checkpoint->>submission_state": "eq.accepted",
          ...(checkpoint.submitted_at ? { "result->provider_checkpoint->>submitted_at": `eq.${checkpoint.submitted_at}` } : {}),
        },
        {
          status: "failed",
          result: {
            ...(job.result || {}),
            ok: false,
            reason: acceptedBudget.reason,
            action: "fail",
            settled_at: at,
          },
          finished_at: at,
          updated_at: at,
        },
      ).catch(() => null);
      continue;
    }
    // Mint-probe the candidate INSIDE the scan: a job whose snapshot can
    // never mint (stale status/lease/line_handle, unsignable claims) must be
    // retired and skipped like a dead parent — returning it aborts the whole
    // broker wave and starves every healthy candidate behind it (measured
    // live 2026-08-29/30: one stale job, 30 consecutive wave errors, worker
    // gave up while fresh heroes sat queued).
    if (typeof mintProbe === "function") {
      let probe;
      try {
        probe = await mintProbe(job);
      } catch (probeError) {
        return { ok: false, error: clean(probeError?.message) || "capability_mint_probe_failed" };
      }
      if (!probe?.ok) {
        await retire(
          queue.HERO_REEL_JOBS_TABLE,
          "job_id",
          job.jobId,
          {
            status: "eq.queued",
            producer: `eq.${OPENROUTER_SEEDANCE_PRODUCER}`,
            lease_token: "is.null",
          },
          {
            status: "failed",
            result: {
              ok: false,
              reason: probe?.reason || "capability_target_conflict",
              action: "fail",
              settled_at: new Date().toISOString(),
            },
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ).catch(() => null);
        continue;
      }
      return { ok: true, job: probe.job || job, claims: probe.claims, token: probe.token };
    }
    return { ok: true, job };
  }
  return { ok: true, job: null };
}

function exactBodyKeys(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  return Object.keys(body).every((key) => allowed.includes(key));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function capabilityMintPage() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>One-job SeaDance launch</title><style>
body{font:16px/1.45 system-ui;background:#0c1018;color:#eef2ff;margin:0;padding:32px}main{max-width:680px;margin:auto}label{display:block;margin:18px 0 6px}input,select,button,textarea{box-sizing:border-box;width:100%;font:inherit;padding:12px;border-radius:8px;border:1px solid #39445a;background:#151c29;color:inherit}button{margin-top:18px;background:#6557ff;border:0;font-weight:700;cursor:pointer}textarea{min-height:150px;margin-top:18px;word-break:break-all}small{color:#aeb8cc}.bad{color:#ff9a9a}.ok{color:#7ce6b2}
</style></head><body><main><h1>One-job SeaDance launch</h1><p>Mint one exact-job capability. It is never saved by this page.</p>
<label for="job">Exact job ID</label><input id="job" autocomplete="off">
<label for="prospect">Exact prospect ID</label><input id="prospect" autocomplete="off">
<label for="phase">Phase</label><select id="phase"><option value="generate">Generate</option><option value="upload">Approved upload</option></select>
<button id="mint" type="button">Mint one-job capability</button><p id="status" aria-live="polite"></p>
<textarea id="capsule" readonly hidden aria-label="One-time launch capsule"></textarea><button id="copy" type="button" hidden>Copy once</button>
<small>The display clears after 90 seconds. Run the stdin-only worker immediately, then clear the clipboard.</small>
<script>(function(){'use strict';var KEY='wsl_admin_token',timer=null,$=function(id){return document.getElementById(id)};
function clear(){if(timer)clearTimeout(timer);timer=null;$('capsule').value='';$('capsule').hidden=true;$('copy').hidden=true}
$('mint').onclick=function(){clear();var token='';try{token=localStorage.getItem(KEY)||''}catch(_){token=''}if(!token){$('status').className='bad';$('status').textContent='Open Command Center first.';return}var body={action:'mint',phase:$('phase').value,job_id:$('job').value.trim(),prospect_id:$('prospect').value.trim()};fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json','x-admin-token':token},body:JSON.stringify(body),cache:'no-store'}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){if(!r.ok)throw new Error(j.error||'mint_failed');return j})}).then(function(j){$('capsule').value=j.launch_capsule||'';$('capsule').hidden=false;$('copy').hidden=false;$('status').className='ok';$('status').textContent='Minted for '+j.job_id+' until '+j.expires_at;timer=setTimeout(clear,90000)}).catch(function(e){$('status').className='bad';$('status').textContent=e.message||'mint_failed'})};
$('copy').onclick=function(){var value=$('capsule').value;if(!value)return;navigator.clipboard.writeText(value).then(function(){$('status').className='ok';$('status').textContent='Copied once. Run it now.';clear()}).catch(function(){$('status').className='bad';$('status').textContent='Copy was blocked.'})};
window.addEventListener('pagehide',clear);})();</script></main></body></html>`;
}

function sendMintPage(res) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store, max-age=0");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(capabilityMintPage());
}

function authStateResponse(res, state) {
  const error = state?.reason === "worker_auth_credential_collision"
    ? "worker_auth_credential_collision"
    : "server_worker_auth_unconfigured";
  sendJson(res, 503, { ok: false, error });
}

function createHeroJobCapabilityHandler(overrides = {}) {
  const deps = {
    env: overrides.env || process.env,
    now: overrides.now || (() => new Date()),
    newJti: overrides.newJti || randomUUID,
    requireAdmin: overrides.requireAdmin || requireAdmin,
    adminAllowed: overrides.adminAllowed || adminAllowed,
    workerAuthState: overrides.heroWorkerAuthState || heroWorkerAuthState,
    getJob: overrides.getHeroReelJob || queue.getHeroReelJob,
    nextJob: overrides.nextQueuedSeedanceJob
      || ((scope) => nextQueuedSeedanceJob({ env: overrides.env || process.env }, scope)),
    recordGrant: overrides.recordHeroJobCapabilityGrant || queue.recordHeroJobCapabilityGrant,
    claim: overrides.claimHeroReelJobWithCapability || queue.claimHeroReelJobWithCapability,
    validateLease: overrides.validateHeroReelJobCapabilityLease || queue.validateHeroReelJobCapabilityLease,
    renew: overrides.renewHeroReelJobCapabilityLease || queue.renewHeroReelJobCapabilityLease,
    checkpoint: overrides.checkpointHeroReelJob || queue.checkpointHeroReelJob,
    settle: overrides.settleHeroReelJobWithCapability || queue.settleHeroReelJobWithCapability,
    requeueUpload: overrides.requeueApprovedHeroUpload || queue.requeueApprovedHeroUpload,
  };

  return async function handler(req, res) {
    if (!methodGuard(req, res, ["GET", "POST"])) return;
    if (req.method === "GET") return sendMintPage(res);
    try {
      const capability = requestHeroJobCapability(req);
      const leaseToken = requestHeroJobLease(req);
      const staticWorkerToken = requestWorkerToken(req);
      const admin = deps.adminAllowed(req);
      const worker = Boolean(staticWorkerToken);
      const lanes = Number(Boolean(capability)) + Number(Boolean(leaseToken)) + Number(Boolean(admin.allowed)) + Number(worker);
      if (lanes !== 1) {
        sendJson(res, lanes > 1 ? 400 : (admin.configured ? 401 : 503), {
          ok: false,
          error: lanes > 1 ? "capability_auth_ambiguous" : (admin.configured ? "unauthorized" : "server_auth_unconfigured"),
        });
        return;
      }

      const state = deps.workerAuthState(deps.env);
      if (!state?.valid || !state.token) return authStateResponse(res, state);

      if (worker) {
        if (!safeTokenEqual(staticWorkerToken, state.token)) {
          return sendJson(res, 401, { ok: false, error: "unauthorized" });
        }
        const body = await readJson(req).catch(() => ({}));
        const practice = body.practice === true;
        const allowedKeys = practice ? ["action", "practice", "batch_id", "row_id"] : ["action"];
        if (!exactBodyKeys(body, allowedKeys)
          || clean(body.action) !== "next"
          || (practice && (Object.keys(body).length !== 4 || !clean(body.batch_id) || !clean(body.row_id)))
          || (!practice && Object.keys(body).length !== 1)) {
          return sendJson(res, 403, { ok: false, error: "capability_action_forbidden" });
        }
        // Mint-probe closure: the scan loop calls this per candidate so a
        // stale/unmintable snapshot is retired IN THE LOOP and the scan
        // continues to the next candidate — the first candidate can no longer
        // starve every healthy one behind it (08-29/30 incident).
        const mintProbe = (job) => {
          const lineHandle = normalizeLineHandle(job?.payload?.line_handle);
          const approvedSha = queue.exactApprovedClipSha(job);
          const phase = approvedSha ? "upload" : "generate";
          if (job.status !== "queued" || job.producer !== OPENROUTER_SEEDANCE_PRODUCER
            || job.leaseToken || job.leaseOwner || job.leaseExpiresAt || !lineHandle) {
            return { ok: false };
          }
          try {
            const claims = newHeroJobCapabilityClaims({
              phase,
              job_id: job.jobId,
              prospect_id: job.prospectId,
              producer: job.producer,
              generation_revision: Number(job.payload?.generation_revision) || 1,
              attempt: job.attempts,
              batch_id: lineHandle.batchId,
              row_id: lineHandle.rowId,
              ...(phase === "upload" ? { approved_sha256: approvedSha } : {}),
            }, { nowMs: deps.now().getTime(), jti: deps.newJti() });
            const token = signHeroJobCapability(state.token, claims);
            return { ok: true, job, claims, token };
          } catch {
            return { ok: false };
          }
        };
        const selected = await deps.nextJob(practice ? {
          practice: true,
          practiceBatchId: clean(body.batch_id),
          practiceRowId: clean(body.row_id),
          mintProbe,
        } : { mintProbe });
        if (!selected?.ok) return sendJson(res, 503, { ok: false, error: clean(selected?.error) || "hero_reel_queue_unavailable" });
        if (!selected.job) return sendJson(res, 200, { ok: true, job: null });
        let job = selected.job;
        let claims = selected.claims;
        let token = selected.token;
        // Overrides/legacy nextJob implementations return a bare job without
        // pre-built claims — validate and build here so every caller shape
        // produces a mintable grant.
        if (!claims || !token) {
          const probe = mintProbe(job);
          if (!probe?.ok) return sendJson(res, 409, { ok: false, error: "capability_target_conflict" });
          job = probe.job || job;
          claims = probe.claims;
          token = probe.token;
        }
        const phase = claims.phase;
        const previous = queue.capabilityGrantForJob(job);
        const recorded = await deps.recordGrant({
          jobId: job.jobId,
          claims,
          expectedGrantJtiSha256: previous?.jti_sha256 || "",
          allowExpiredRecovery: true,
        });
        if (!recorded?.ok) {
          const error = clean(recorded?.error) || "hero_reel_queue_unavailable";
          return sendJson(res, error.includes("conflict") ? 409 : 503, { ok: false, error });
        }
        return sendJson(res, 200, {
          ok: true,
          schema: HERO_JOB_CAPABILITY_LAUNCH_SCHEMA,
          phase,
          expires_at: new Date(claims.exp * 1000).toISOString(),
          launch_capsule: JSON.stringify({ schema: HERO_JOB_CAPABILITY_LAUNCH_SCHEMA, phase, capability: token }),
        });
      }

      if (admin.allowed) {
        if (!deps.requireAdmin(req, res)) return;
        const body = await readJson(req).catch(() => ({}));
        if (!exactBodyKeys(body, MINT_FIELDS) || clean(body.action) !== "mint") {
          return sendJson(res, 400, { ok: false, error: "capability_mint_request_invalid" });
        }
        const phase = clean(body.phase);
        const jobId = clean(body.job_id);
        const prospectId = clean(body.prospect_id);
        if (!jobId) return sendJson(res, 400, { ok: false, error: "job_id_required" });
        if (!prospectId) return sendJson(res, 400, { ok: false, error: "prospect_id_required" });
        if (!["generate", "upload"].includes(phase)) {
          return sendJson(res, 400, { ok: false, error: "capability_phase_invalid" });
        }
        const found = await deps.getJob(jobId);
        if (!found?.ok) {
          const error = clean(found?.error) || "hero_reel_queue_unavailable";
          return sendJson(res, error === "unknown_job" ? 404 : 503, { ok: false, error });
        }
        const job = found.job;
        const lineHandle = normalizeLineHandle(job?.payload?.line_handle);
        const approvedSha = queue.exactApprovedClipSha(job);
        const previous = queue.capabilityGrantForJob(job);
        const leaseExpiryMs = Date.parse(String(job.leaseExpiresAt || ""));
        const freshTarget = job.status === "queued" && !job.leaseToken && !job.leaseOwner && !job.leaseExpiresAt;
        const expiredRecovery = Boolean(
          job.status === "running"
          && job.leaseToken
          && job.leaseOwner
          && Number.isFinite(leaseExpiryMs)
          && leaseExpiryMs <= deps.now().getTime()
          && previous?.phase === phase
          // Preliminary fail-closed check. The queue revalidates the full
          // checkpoint against job/source identity before its atomic reset.
          && (phase === "upload" || Boolean(job.result?.provider_checkpoint))
        );
        if (
          job.jobId !== jobId
          || job.prospectId !== prospectId
          || job.producer !== OPENROUTER_SEEDANCE_PRODUCER
          || (!freshTarget && !expiredRecovery)
          || !lineHandle
          || (phase === "generate" && Boolean(job.payload?.approved_clip?.approved))
          || (phase === "upload" && !approvedSha)
        ) return sendJson(res, 409, { ok: false, error: "capability_target_conflict" });

        let claims;
        let token;
        try {
          claims = newHeroJobCapabilityClaims({
            phase,
            job_id: job.jobId,
            prospect_id: job.prospectId,
            producer: job.producer,
            generation_revision: Number(job.payload?.generation_revision) || 1,
            attempt: job.attempts,
            batch_id: lineHandle.batchId,
            row_id: lineHandle.rowId,
            ...(phase === "upload" ? { approved_sha256: approvedSha } : {}),
          }, { nowMs: deps.now().getTime(), jti: deps.newJti() });
          token = signHeroJobCapability(state.token, claims);
        } catch {
          return sendJson(res, 409, { ok: false, error: "capability_target_conflict" });
        }
        const recorded = await deps.recordGrant({
          jobId: job.jobId,
          claims,
          expectedGrantJtiSha256: previous?.jti_sha256 || "",
          allowExpiredRecovery: true,
        });
        if (!recorded?.ok) {
          const error = clean(recorded?.error) || "hero_reel_queue_unavailable";
          return sendJson(res, error.includes("conflict") ? 409 : 503, { ok: false, error });
        }
        const launchCapsule = JSON.stringify({
          schema: HERO_JOB_CAPABILITY_LAUNCH_SCHEMA,
          phase,
          capability: token,
        });
        return sendJson(res, 200, {
          ok: true,
          schema: HERO_JOB_CAPABILITY_LAUNCH_SCHEMA,
          phase,
          job_id: job.jobId,
          prospect_id: job.prospectId,
          expires_at: new Date(claims.exp * 1000).toISOString(),
          launch_capsule: launchCapsule,
        });
      }

      if (capability) {
        const verified = verifyHeroJobCapability(state.token, capability, { nowMs: deps.now().getTime() });
        if (!verified.ok) {
          const expired = verified.error === "capability_expired";
          return sendJson(res, expired ? 410 : 401, {
            ok: false,
            error: expired ? "capability_expired" : "capability_invalid",
          });
        }
        const body = await readJson(req).catch(() => ({}));
        if (
          !exactBodyKeys(body, ["action", "redemption_id"])
          || Object.keys(body).length !== 2
          || clean(body.action) !== "claim"
        ) {
          return sendJson(res, 403, { ok: false, error: "capability_action_forbidden" });
        }
        const redemptionId = clean(body.redemption_id).toLowerCase();
        try { heroJobCapabilityRedemptionSha256(redemptionId); } catch {
          return sendJson(res, 400, { ok: false, error: "capability_redemption_id_invalid" });
        }
        const claimed = await deps.claim({ claims: verified.claims, redemptionId });
        if (!claimed?.ok) {
          const error = clean(claimed?.error) || "hero_reel_queue_unavailable";
          const status = error === "capability_expired"
            ? 410
            : error.includes("conflict")
              ? 409
              : error === "unknown_job" ? 404 : 503;
          return sendJson(res, status, { ok: false, error });
        }
        return sendJson(res, 200, claimed);
      }

      const body = await readJson(req).catch(() => ({}));
      const action = clean(body.action).toLowerCase();
      const jobId = clean(body.job_id || body.jobId);
      if (!jobId) return sendJson(res, 400, { ok: false, error: "job_id_required" });
      if (action === "renew") {
        if (!exactBodyKeys(body, ["action", "job_id"])) return sendJson(res, 400, { ok: false, error: "capability_request_invalid" });
        const renewed = await deps.renew({ jobId, leaseToken });
        return renewed?.ok
          ? sendJson(res, 200, renewed)
          : sendJson(res, 409, { ok: false, error: clean(renewed?.error) || "capability_lease_conflict" });
      }
      if (action === "checkpoint") {
        if (!exactBodyKeys(body, ["action", "job_id", "checkpoint"])) return sendJson(res, 400, { ok: false, error: "capability_request_invalid" });
        const valid = await deps.validateLease({ jobId, leaseToken, phase: "generate" });
        if (!valid?.ok) return sendJson(res, 409, { ok: false, error: clean(valid?.error) || "capability_lease_conflict" });
        const saved = await deps.checkpoint({ jobId, leaseToken, checkpoint: body.checkpoint });
        return saved?.ok
          ? sendJson(res, 200, saved)
          : sendJson(res, 409, { ok: false, error: clean(saved?.error) || "capability_lease_conflict" });
      }
      if (action === "settle") {
        if (!exactBodyKeys(body, ["action", "job_id", "outcome", "verdict"])) return sendJson(res, 400, { ok: false, error: "capability_request_invalid" });
        const outcome = clean(body.outcome).toLowerCase();
        if (!LEASE_SETTLE_OUTCOMES.has(outcome)) return sendJson(res, 403, { ok: false, error: "capability_action_forbidden" });
        // The queue owns the full lease/action validation and its settlement is
        // idempotent for the same lease. A preflight here would reject the safe
        // replay after the first hold committed but its response was lost.
        const settled = await deps.settle({ jobId, leaseToken, action: outcome, verdict: body.verdict });
        return settled?.ok
          ? sendJson(res, 200, settled)
          : sendJson(res, 409, { ok: false, error: clean(settled?.error) || "capability_lease_conflict" });
      }
      if (action === "requeue_upload") {
        if (!exactBodyKeys(body, ["action", "job_id", "reason"])) return sendJson(res, 400, { ok: false, error: "capability_request_invalid" });
        const requeued = await deps.requeueUpload({ jobId, leaseToken, reason: body.reason });
        return requeued?.ok
          ? sendJson(res, 200, requeued)
          : sendJson(res, 409, {
            ok: false,
            error: clean(requeued?.error) || "capability_lease_conflict",
            ...(requeued?.detail ? { detail: requeued.detail } : {}),
            ...(requeued?.job_state ? { job_state: requeued.job_state } : {}),
          });
      }
      return sendJson(res, 403, { ok: false, error: "capability_action_forbidden" });
    } catch (error) {
      handleError(res, error, "hero_job_capability_failed");
    }
  };
}

const handler = createHeroJobCapabilityHandler();

module.exports = handler;
module.exports.handler = handler;
module.exports.createHeroJobCapabilityHandler = createHeroJobCapabilityHandler;
module.exports.capabilityMintPage = capabilityMintPage;
module.exports.nextQueuedSeedanceJob = nextQueuedSeedanceJob;
