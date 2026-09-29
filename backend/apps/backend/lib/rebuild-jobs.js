"use strict";

/**
 * lib/rebuild-jobs.js — the durable rebuild queue, behind /api/admin/rebuild-mirror.
 *
 * WHY THIS EXISTS. The route used to run mirrorProspect() inline in the
 * operator's request. A rebuild is a real build — measured build+deploy is
 * ~127s — and on 2026-08-17 a live rebuild deployed successfully but its
 * RESPONSE died at Vercel's 300s FUNCTION_INVOCATION_TIMEOUT, the same death
 * four Mines had already died. The work survives; only the answer is lost, and
 * the operator is left staring at a 504 for a site that is actually live.
 *
 * THE PATTERN IS THE ONE THE LINE ALREADY PROVED (api/cron/run-edit-jobs.js,
 * lib/line-continuation.js): durably enqueue, ack fast, and let a worker that
 * does not owe anybody a response do the building in passes.
 *
 *   · enqueueRebuildJob() writes one row: queued. Nothing else.
 *   · runRebuildJob() claims it with ONE conditional PATCH (queued -> running,
 *     one-shot claim token), rebuilds, and writes the verdict verbatim — the
 *     same {ok, preview_url, build_hash, reason} the inline route returned,
 *     so a refusal keeps the lane's own sentence.
 *   · The route fires runRebuildJob() un-awaited right after it acks (the
 *     "kick"): in the common case the rebuild starts immediately in the same
 *     lambda. If the lambda freezes at res.end, the atomic claim makes a
 *     frozen kick and the cron sweeper safe against each other, and a stale
 *     "running" claim is reclaimed after STALE_RUNNING_MS.
 *   · api/cron/run-rebuild-mirror-jobs drains the queue every 2 minutes —
 *     at most DRAIN_MAX jobs per pass, because one rebuild is ~127s of a
 *     300s function and 1-2 per pass is the honest budget.
 *
 * IT SENDS NOTHING, exactly like the route it backs. No email, no SMS, no
 * approval, no prospect contact. The dependency list of both files is pinned
 * by test/rebuild-mirror-route.test.js to stay that way.
 */

const { createHash, randomUUID } = require("node:crypto");
const store = require("./store");
const { normalizeLineHandle, exactWaitingHeroRow } = require("./line-hero-wakeup");
const {
  LINE_HERO_REBUILD_SCHEMA,
  ownedHeroVideoPlaced,
  validatedLineHeroRebuild,
} = require("./line-persisted-mirror");

const REBUILD_JOBS_TABLE = "ghost_agency_rebuild_jobs";
const JOB_STATUSES = Object.freeze(["queued", "running", "done", "failed"]);

// One rebuild is a measured ~127s of build+deploy. Give a running claim six
// minutes before deciding its lambda died — the same order the line worker
// uses (STALE_WORKER_MS) — so a slow deploy is never mistaken for a corpse.
const STALE_RUNNING_MS = 6 * 60 * 1000;
// A job that has died mid-run this many times stays dead, with the verdict
// that says so. Rebuilding forever against a broken prospect helps nobody.
const MAX_ATTEMPTS = 3;
// The honest per-pass drain budget: ~127s per rebuild inside a 300s function.
const DEFAULT_DRAIN_MAX = 2;

function drainMax(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 5) : DEFAULT_DRAIN_MAX;
}

function newRebuildJobId() {
  return `rebuild_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function safeCode(value, fallback = "rebuild_job_failed") {
  const code = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_");
  return /^[a-z][a-z0-9_.:-]{0,79}$/.test(code) ? code : fallback;
}

function heroRebuildJobId(prospectId, heroJobId, heroClipSha256) {
  const prospect = String(prospectId || "").trim();
  const hero = safeJobId(heroJobId);
  const clipSha = String(heroClipSha256 || "").trim().toLowerCase();
  if (!prospect || !hero || !/^[a-f0-9]{64}$/.test(clipSha)) return "";
  const digest = createHash("sha256")
    .update(`hero-rebuild/v2\0${prospect}\0${hero}\0${clipSha}`)
    .digest("hex")
    .slice(0, 40);
  return `rebuild_hero_${digest}`;
}

function proofRecordMatches(record = {}, proof = {}) {
  const stored = record?.proof_shots;
  return Boolean(stored
    && String(stored.build_hash || "") === String(proof.build_hash || "")
    && String(stored.old_captured_url || "") === String(proof.old_captured_url || "")
    && String(stored.new_captured_url || "") === String(proof.new_captured_url || "")
    && String(stored.old_shot_sha || "").toLowerCase() === String(proof.old_shot_sha || "").toLowerCase()
    && String(stored.new_shot_sha || "").toLowerCase() === String(proof.new_shot_sha || "").toLowerCase());
}

function proofCaptureReason(capture = {}) {
  const mismatch = (capture.results || []).find((result) => (
    /^old(?:-|$)/.test(String(result?.variant || ""))
    && /^capture_identity_/.test(String(result?.reason || ""))
  ));
  return mismatch
    ? String(mismatch.reason)
    : String(capture.reason || "rebuild_proof_incomplete");
}

/**
 * Preserve the server-produced Mirror artifact on the durable rebuild job.
 * The Line wake runs in a later lambda and needs this signed envelope to move
 * straight to its normal render gate instead of deploying the same site twice.
 * publicVerdict intentionally does not expose this private packet.
 */
function durableBuildArtifact(out = {}) {
  const buildEvidence = out.buildEvidence && typeof out.buildEvidence === "object"
    ? out.buildEvidence
    : out.build_evidence && typeof out.build_evidence === "object"
      ? out.build_evidence
      : null;
  const releaseEvidence = out.releaseEvidence && typeof out.releaseEvidence === "object"
    ? out.releaseEvidence
    : out.release_evidence && typeof out.release_evidence === "object"
      ? out.release_evidence
      : buildEvidence?.release_evidence && typeof buildEvidence.release_evidence === "object"
        ? buildEvidence.release_evidence
        : null;
  const previewUrl = String(out.previewUrl || out.preview_url || "").trim();
  const buildHash = String(out.buildHash || out.build_hash || "").trim();
  if (out.ok !== true || !previewUrl || !buildHash || !buildEvidence || !releaseEvidence) return null;
  return {
    preview_url: previewUrl,
    build_hash: buildHash,
    build_evidence: buildEvidence,
    release_evidence: releaseEvidence,
    content_source: String(out.contentSource || out.content_source || ""),
    current_website: String(out.currentWebsite || out.current_website || ""),
    published_aggregate: out.publishedAggregate || out.published_aggregate || null,
    photo_accounting: out.photoAccounting || out.photo_accounting || null,
  };
}

function safeJobId(value) {
  const id = String(value || "").trim();
  return id.length > 0 && id.length <= 240 && /^[A-Za-z0-9_.:-]+$/.test(id) ? id : "";
}

function lineHeroRebuildMarker({
  prospectId, rebuildJobId, heroJobId, heroClipSha256, lineHandle, reelUrl, photoBank, artifact, completedAt,
} = {}) {
  const handle = normalizeLineHandle(lineHandle);
  const evidence = artifact?.build_evidence && typeof artifact.build_evidence === "object"
    ? artifact.build_evidence
    : null;
  const release = artifact?.release_evidence && typeof artifact.release_evidence === "object"
    ? artifact.release_evidence
    : null;
  const rebuildId = safeJobId(rebuildJobId);
  const heroId = safeJobId(heroJobId);
  const clipSha = String(heroClipSha256 || "").trim().toLowerCase();
  const id = String(prospectId || "").trim();
  const previewUrl = String(artifact?.preview_url || "").trim();
  const buildHash = String(artifact?.build_hash || "").trim();
  const reel = String(reelUrl || "").trim();
  const bank = photoBank && typeof photoBank === "object" && Array.isArray(photoBank.photos)
    ? photoBank
    : null;
  if (!handle || !rebuildId || !heroId || !/^[a-f0-9]{64}$/.test(clipSha) || !id || !previewUrl || !buildHash
    || !/^https:\/\//i.test(reel) || !bank || bank.photos.length < 1 || !evidence || !release
    || !ownedHeroVideoPlaced(release)) return null;
  const dispatch = {
    mode: "mirror_engine",
    pending: false,
    ready: true,
    preview_url: previewUrl,
    urls: { preview_url: previewUrl },
    renderer: String(evidence.renderer || ""),
    required_renderer: String(evidence.renderer || ""),
    qc_contract: String(evidence.qc_contract || ""),
    required_qc_contract: String(evidence.qc_contract || ""),
    evidence_schema: String(evidence.evidence_schema || ""),
    evidence_sha: String(evidence.evidence_sha || ""),
    qc_passed: evidence.qc_passed === true,
    visual_qc_passed: evidence.visual_qc_passed === true,
    generation_fingerprint: String(evidence.generation_fingerprint || ""),
    build_hash: buildHash,
    content_source: String(evidence.content_source || artifact.content_source || ""),
    release_evidence: release,
    published_aggregate: artifact.published_aggregate || null,
    photo_accounting: artifact.photo_accounting || null,
    job_id: rebuildId,
  };
  return {
    schema: LINE_HERO_REBUILD_SCHEMA,
    prospect_id: id,
    line_handle: handle,
    hero_job_id: heroId,
    hero_clip_sha256: clipSha,
    rebuild_job_id: rebuildId,
    reel_url: reel,
    preview_url: previewUrl,
    build_hash: buildHash,
    build_dispatch: dispatch,
    release_evidence: release,
    photo_bank: bank,
    completed_at: String(completedAt || ""),
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameJson(left, right) {
  try { return canonicalJson(left) === canonicalJson(right); } catch { return false; }
}

function jobRows(result) {
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function jobFromRow(raw) {
  if (!raw) return null;
  const result = raw.result && typeof raw.result === "object" ? raw.result : {};
  return {
    jobId: String(raw.job_id || ""),
    prospectId: String(raw.prospect_id || ""),
    status: JOB_STATUSES.includes(raw.status) ? raw.status : "queued",
    attempts: Number(raw.attempts) || 0,
    claim: String(result.claim || ""),
    result,
    createdAt: raw.created_at || null,
    updatedAt: raw.updated_at || null,
  };
}

/**
 * The verdict, in the exact shape the inline route always returned — a
 * refusal keeps its own sentence, a success names the URL and the build hash.
 */
function publicVerdict(job, businessName = "") {
  const verdict = job && job.result ? job.result : {};
  return {
    ok: verdict.ok === true,
    job_id: job ? job.jobId : "",
    prospect_id: job ? job.prospectId : "",
    business_name: String(verdict.business_name || businessName || ""),
    status: job ? job.status : "unknown",
    seconds: Number(verdict.seconds) || 0,
    preview_url: String(verdict.preview_url || ""),
    build_hash: String(verdict.build_hash || ""),
    proof_shots_ready: verdict.proof_shots_ready === true,
    proof_build_hash: String(verdict.proof_build_hash || ""),
    proof_reason: String(verdict.proof_reason || ""),
    reason: verdict.ok === true ? "" : String(verdict.reason || "refused_without_a_reason"),
    terminal: String(verdict.terminal || ""),
  };
}

function createRebuildJobs(dependencies = {}) {
  const deps = {
    insertRow: dependencies.insertRow || store.insertRow,
    select: dependencies.select || store.select,
    conditionalUpdate: dependencies.conditionalUpdate || store.conditionalUpdate,
    recordEvent: dependencies.recordEvent || store.recordEvent,
    now: dependencies.now || (() => new Date()),
    newJobId: dependencies.newJobId || newRebuildJobId,
    captureLineEmailAssets: dependencies.captureLineEmailAssets
      || ((input) => require("./line-email-assets").captureLineEmailAssets(input)),
    automaticProofShotRecord: dependencies.automaticProofShotRecord
      || ((capture) => require("./line-email-assets").automaticProofShotRecord(capture)),
    wakeLineForCompletedHero: dependencies.wakeLineForCompletedHero
      || ((prospectId, lineHandle) => require("./line-hero-wakeup").wakeLineForCompletedHero(prospectId, lineHandle)),
    loadLineBatch: dependencies.loadLineBatch
      || ((batchId) => require("./line-persistence").loadBatch(batchId)),
  };
  // Service-level build defaults, so the kick and the cron drain run the real
  // mirror without every caller threading it through. Tests override per call.
  const defaultMirror = dependencies.mirrorProspect;

  const iso = () => deps.now().toISOString();

  function storeUnavailable(result) {
    return !result || result.mode === "dry_run" || result.configured === false || result.ok === false;
  }

  async function lineParentGate(job) {
    const handle = normalizeLineHandle(job?.result?.line_handle);
    if (!handle) return { ok: true };
    const loaded = await deps.loadLineBatch(handle.batchId).catch(() => null);
    if (!loaded || loaded.ok !== true || !loaded.batch) {
      if (String(loaded?.error || "") === "batch_not_found") {
        return { ok: false, reason: "parent_line_generation_superseded", retryable: false };
      }
      return { ok: false, reason: "parent_line_batch_status_unavailable", retryable: true };
    }
    const batch = loaded.batch;
    if (String(batch.status || "") === "halted") {
      return { ok: false, reason: "parent_line_batch_halted", retryable: false, batch };
    }
    const row = exactWaitingHeroRow(batch, job.prospectId, handle);
    const expectedHeroJobId = safeJobId(job?.result?.hero_job_id);
    if (!row || (expectedHeroJobId && safeJobId(row?.heroRemaster?.jobId) !== expectedHeroJobId)) {
      return { ok: false, reason: "parent_line_generation_superseded", retryable: false, batch };
    }
    return { ok: true, batch, row };
  }

  async function retireQueuedParentFailure(job, reason) {
    const result = {
      ...(job.result || {}),
      ok: false,
      reason,
      terminal: "rejected",
      settled_at: iso(),
    };
    const retired = await deps.conditionalUpdate(
      REBUILD_JOBS_TABLE,
      "job_id",
      job.jobId,
      { status: "eq.queued" },
      { status: "failed", result, updated_at: iso() },
    ).catch(() => null);
    return retired?.ok === true && retired.updated === true;
  }

  async function enqueueRebuildJob({ prospectId, actor = "operator", lineHandle, heroJobId, heroClipSha256 } = {}) {
    const id = String(prospectId || "").trim();
    if (!id) return { ok: false, error: "prospect_id_required" };
    const handle = normalizeLineHandle(lineHandle);
    const heroId = safeJobId(heroJobId);
    const clipSha = String(heroClipSha256 || "").trim().toLowerCase();
    if (heroId && !/^[a-f0-9]{64}$/.test(clipSha)) return { ok: false, error: "hero_clip_sha256_required" };
    const jobId = heroId ? heroRebuildJobId(id, heroId, clipSha) : deps.newJobId();
    let inserted;
    try {
      inserted = await deps.insertRow(REBUILD_JOBS_TABLE, {
        job_id: jobId,
        prospect_id: id,
        status: "queued",
        attempts: 0,
        result: handle || heroId ? {
          ...(handle ? { line_handle: handle } : {}),
          ...(heroId ? { hero_job_id: heroId } : {}),
          ...(heroId ? { hero_clip_sha256: clipSha } : {}),
        } : null,
        created_at: iso(),
        updated_at: iso(),
      });
    } catch {
      inserted = null;
    }
    if (storeUnavailable(inserted)) {
      // Hero uploads can lose the HTTP response after INSERT but before their
      // terminal receipt settles. Their prospect+hero job key is stable, so an
      // identical retry reuses the one durable rebuild instead of deploying
      // the same site twice. Any lineage difference is a hard conflict.
      if (heroId) {
        const existing = await getRebuildJob(jobId);
        if (existing.ok === true && existing.job) {
          const existingHandle = normalizeLineHandle(existing.job.result?.line_handle);
          const sameHandle = sameJson(existingHandle, handle);
          if (existing.job.prospectId === id
            && safeJobId(existing.job.result?.hero_job_id) === heroId
            && String(existing.job.result?.hero_clip_sha256 || "").toLowerCase() === clipSha
            && sameHandle) {
            return {
              ok: true,
              jobId,
              prospectId: id,
              status: existing.job.status,
              actor,
              reused: true,
            };
          }
          return { ok: false, error: "rebuild_idempotency_conflict" };
        }
      }
      // NEVER fall back to an inline build from here: the caller asked for a
      // durable job, and silently running ~127s of build inside the request is
      // the exact 504 this queue exists to end.
      return { ok: false, error: "rebuild_queue_unavailable" };
    }
    return { ok: true, jobId, prospectId: id, status: "queued", actor, reused: false };
  }

  async function getRebuildJob(jobId) {
    const id = String(jobId || "").trim();
    if (!id) return { ok: false, error: "job_id_required" };
    const read = await deps.select(
      REBUILD_JOBS_TABLE,
      `?select=*&job_id=eq.${encodeURIComponent(id)}&limit=1`,
    ).catch(() => null);
    if (!read || read.ok !== true) return { ok: false, error: "rebuild_queue_unavailable" };
    const row = jobRows(read)[0] || null;
    if (!row) return { ok: false, error: "unknown_job" };
    return { ok: true, job: jobFromRow(row) };
  }

  /**
   * ONE conditional PATCH is the whole claim. It succeeds only while the row is
   * still "queued", so a frozen kick and the cron sweeper cannot both build the
   * same prospect, and the one-shot token in result.claim proves the running
   * row is OURS when the PATCH's read-back is inconclusive.
   */
  async function claimRebuildJob(jobId) {
    const claimToken = randomUUID();
    const at = iso();
    const queued = await getRebuildJob(jobId);
    if (!queued.ok) return { ok: false, error: "claim_unavailable" };
    if (queued.job.status !== "queued") {
      return { ok: false, error: queued.job.status === "running" ? "in_flight" : "already_finished", status: queued.job.status };
    }
    const parent = await lineParentGate(queued.job);
    if (!parent.ok) {
      if (parent.retryable) return { ok: false, error: parent.reason };
      await retireQueuedParentFailure(queued.job, parent.reason);
      return { ok: false, error: parent.reason, status: "failed" };
    }
    const lineHandle = normalizeLineHandle(queued.job.result?.line_handle);
    const heroJobId = safeJobId(queued.job.result?.hero_job_id);
    const heroClipSha256 = String(queued.job.result?.hero_clip_sha256 || "").trim().toLowerCase();
    let claim;
    try {
      claim = await deps.conditionalUpdate(
        REBUILD_JOBS_TABLE,
        "job_id",
        jobId,
        { status: "eq.queued" },
        {
          status: "running",
          result: {
            claim: claimToken,
            ...(lineHandle ? { line_handle: lineHandle } : {}),
            ...(heroJobId ? { hero_job_id: heroJobId } : {}),
            ...(heroClipSha256 ? { hero_clip_sha256: heroClipSha256 } : {}),
          },
          updated_at: at,
        },
      );
    } catch {
      claim = null;
    }
    if (claim && claim.ok === true && claim.updated === true) {
      // return=representation hands back the claimed row, prospect_id included.
      const job = jobFromRow((claim.rows || [])[0]);
      if (job && job.prospectId) return { ok: true, job, claimToken };
    }
    // Inconclusive: re-read and decide from the durable row, never a guess.
    const read = await getRebuildJob(jobId);
    if (!read.ok) return { ok: false, error: "claim_unavailable" };
    const job = read.job;
    if (job.status === "queued") return { ok: false, error: "claim_unavailable" };
    if (job.status === "running") {
      return job.claim === claimToken
        ? { ok: true, job, claimToken }
        : { ok: false, error: "in_flight", status: "running" };
    }
    return { ok: false, error: "already_finished", status: job.status };
  }

  async function settleRebuildJob(jobId, claimToken, status, result) {
    let settled;
    try {
      settled = await deps.conditionalUpdate(
        REBUILD_JOBS_TABLE,
        "job_id",
        jobId,
        // BOTH guards: still running AND still OURS. A sweep may have requeued
        // this job after STALE_RUNNING_MS and a second worker may already be
        // running it — a zombie's late verdict must never overwrite the living
        // worker's row. (store.conditionalUpdate passes ->> filters through.)
        { status: "eq.running", "result->>claim": `eq.${claimToken}` },
        { status, result, updated_at: iso() },
      );
    } catch {
      settled = null;
    }
    if (settled && settled.ok === true && settled.updated === true) return { ok: true };
    // The claim may have been reclaimed mid-build (a very slow deploy past
    // STALE_RUNNING_MS). The verdict still deserves to live somewhere: the
    // event log keeps it even when the row no longer belongs to us.
    return { ok: false, error: "settle_conflict" };
  }

  /**
   * runRebuildJob — claim, rebuild, settle. The build itself is the same
   * mirrorProspect() the inline route called, with the same inputs re-read
   * fresh from the durable prospect row (a worker may run minutes after the
   * queue call; it never trusts a stale payload).
   */
  async function runRebuildJob(jobId, runDeps = {}) {
    const mirror = runDeps.mirrorProspect || defaultMirror || require("./line-adapters").mirrorProspect;
    const select = runDeps.select || deps.select;
    const claim = await claimRebuildJob(jobId);
    if (!claim.ok) return { ok: false, error: claim.error, status: claim.status || "" };
    const claimedId = String(claim.job?.prospectId || "");

    const found = await select(
      "ghost_agency_prospects",
      `select=*&prospect_id=eq.${encodeURIComponent(claimedId)}&limit=1`,
    ).catch(() => null);
    const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
    // The enqueueing request already proved the prospect exists; a row that
    // vanishes between enqueue and run is a verdict, not a crash.
    const businessName = String((row && (row.business_name || (row.record && row.record.business_name))) || "");
    const vertical = String((row && (row.industry || (row.record && row.record.industry))) || "");
    const prospectId = String((row && row.prospect_id) || claimedId);
    const lineHandle = normalizeLineHandle(claim.job?.result?.line_handle);
    const heroJobId = safeJobId(claim.job?.result?.hero_job_id);
    const heroClipSha256 = String(claim.job?.result?.hero_clip_sha256 || "").trim().toLowerCase();

    const startedAt = Date.now();
    let out;
    try {
      out = await mirror(
        { prospectId, businessName, vertical },
        // This job exists because the verified reel is already on the record.
        // Bypass only the Line's pre-build wait or the rebuild would wait on
        // itself forever; all normal Mirror truth/QC gates remain intact.
        { lane: "live", heroRebuild: true, operationKey: jobId },
      );
    } catch (error) {
      const reason = `rebuild_mirror_error: ${safeCode(error?.code || error?.message).slice(0, 120)}`;
      await settleRebuildJob(jobId, claim.claimToken, "failed", {
        ok: false, reason, business_name: businessName, seconds: Math.round((Date.now() - startedAt) / 1000),
        ...(lineHandle ? { line_handle: lineHandle } : {}),
        ...(heroJobId ? { hero_job_id: heroJobId } : {}),
        ...(heroClipSha256 ? { hero_clip_sha256: heroClipSha256 } : {}),
      });
      return { ok: false, jobId, status: "failed", reason };
    }

    // A rebuild may outlive the Line generation that requested it. Re-read the
    // exact parent before proof capture/persistence so a halted or superseded
    // row cannot publish an artifact into a newer generation.
    const parentAfterBuild = await lineParentGate(claim.job);
    if (!parentAfterBuild.ok) {
      const reason = parentAfterBuild.reason;
      await settleRebuildJob(jobId, claim.claimToken, "failed", {
        ...(claim.job.result || {}),
        ok: false,
        reason,
        terminal: "rejected",
        business_name: businessName,
        seconds: Math.round((Date.now() - startedAt) / 1000),
      });
      return { ok: false, jobId, status: "failed", reason };
    }

    const seconds = Math.round((Date.now() - startedAt) / 1000);
    // A refusal is a FINISHED job with an honest verdict, not a failure of the
    // queue: status "done", result.ok false, the lane's own sentence verbatim.
    const buildArtifact = durableBuildArtifact(out);
    let lineArtifactReady = false;
    let proof = { ready: false, buildHash: String(out.buildHash || ""), reason: "rebuild_not_successful" };
    if (out.ok === true) {
      const reread = await select(
        "ghost_agency_prospects",
        `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
      ).catch(() => null);
      const canonical = reread?.ok === true && Array.isArray(reread.data) ? reread.data[0] : null;
      if (!canonical) {
        proof = { ready: false, buildHash: String(out.buildHash || ""), reason: "rebuild_proof_record_read_failed" };
      } else {
        const canonicalRecord = canonical.record && typeof canonical.record === "object" ? canonical.record : {};
        const capture = await deps.captureLineEmailAssets({
          previewUrl: out.previewUrl || "",
          currentWebsite: canonicalRecord.current_website || canonical.current_website || "",
          buildHash: out.buildHash || "",
          motion: false,
        }).catch((error) => ({ ok: false, reason: `rebuild_proof_capture_failed:${safeCode(error?.message)}`, shots: {}, results: [] }));
        const proofShots = deps.automaticProofShotRecord(capture);
        if (!proofShots || String(proofShots.build_hash || "") !== String(out.buildHash || "")) {
          proof = { ready: false, buildHash: String(out.buildHash || ""), reason: proofCaptureReason(capture) };
        } else if (!String(canonical.updated_at || "").trim()) {
          proof = { ready: false, buildHash: String(out.buildHash || ""), reason: "rebuild_proof_record_version_missing" };
        } else {
          const at = iso();
          const reelUrl = String(canonicalRecord.media_bank?.hero_reel?.url || "").trim();
          const canonicalStatus = String(canonical.status || canonicalRecord.status || "").trim().toLowerCase();
          const markerCandidate = lineHandle && !["sent", "contacted", "delivered"].includes(canonicalStatus)
            ? lineHeroRebuildMarker({
            prospectId,
            rebuildJobId: jobId,
            heroJobId,
            heroClipSha256,
            lineHandle,
            reelUrl,
            photoBank: canonicalRecord.photo_bank,
            artifact: buildArtifact,
            completedAt: at,
          }) : null;
          const markerValidated = markerCandidate && validatedLineHeroRebuild(
            {
              ...canonical,
              record: { ...canonicalRecord, line_hero_rebuild: markerCandidate },
            },
            {
              prospectId,
              rowId: lineHandle.rowId,
              heroRemaster: { jobId: heroJobId, rebuildJobId: jobId },
            },
            { batchId: lineHandle.batchId },
          );
          const lineMarker = markerValidated ? markerCandidate : null;
          if (lineHandle && !lineMarker) {
            // A Line rebuild is one atomic truth packet: signed build + owned
            // reel + exact row handle + identity-valid proof. Never persist a
            // half packet that could wake the row onto donor media.
            proof = { ready: false, buildHash: String(out.buildHash || ""), reason: "line_hero_rebuild_artifact_unproven" };
          } else {
            const parentBeforePublish = await lineParentGate(claim.job);
            if (!parentBeforePublish.ok) {
              proof = { ready: false, buildHash: String(out.buildHash || ""), reason: parentBeforePublish.reason };
            } else {
            const recordPatch = {
              ...canonicalRecord,
              proof_shots: proofShots,
              ...(lineMarker ? { line_hero_rebuild: lineMarker } : {}),
            };
            const persisted = await deps.conditionalUpdate(
              "ghost_agency_prospects",
              "prospect_id",
              prospectId,
              { updated_at: `eq.${String(canonical.updated_at).trim()}` },
              { record: recordPatch, updated_at: at },
            ).catch(() => null);
            if (persisted?.ok === true && persisted.updated === true) {
              proof = { ready: true, buildHash: String(out.buildHash || ""), reason: "" };
              lineArtifactReady = Boolean(lineMarker);
            } else {
              const after = await select(
                "ghost_agency_prospects",
                `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
              ).catch(() => null);
              const latest = after?.ok === true && Array.isArray(after.data) ? after.data[0] : null;
              const proofMatches = proofRecordMatches(latest?.record, proofShots);
              const markerMatches = !lineMarker
                || sameJson(latest?.record?.line_hero_rebuild, lineMarker);
              proof = proofMatches && markerMatches
                ? { ready: true, buildHash: String(out.buildHash || ""), reason: "" }
                : { ready: false, buildHash: String(out.buildHash || ""), reason: "rebuild_proof_persist_conflict" };
              lineArtifactReady = Boolean(lineMarker && proofMatches && markerMatches);
            }
            }
          }
        }
      }
    }
    const lineBuildReady = !lineHandle || lineArtifactReady;
    const verdict = {
      ok: out.ok === true && lineBuildReady,
      preview_url: out.previewUrl || "",
      build_hash: out.buildHash || "",
      reason: out.ok === true && !lineBuildReady
        ? String(proof.reason || "line_hero_rebuild_artifact_unproven")
        : out.ok === true ? "" : String(out.reason || "refused_without_a_reason"),
      terminal: out.ok === true && !lineBuildReady ? "rejected" : (out.terminal || ""),
      business_name: businessName,
      seconds,
      proof_shots_ready: proof.ready === true,
      proof_build_hash: proof.buildHash,
      proof_reason: proof.reason,
      line_artifact_ready: lineArtifactReady,
      ...(buildArtifact ? { build_artifact: buildArtifact } : {}),
      ...(lineHandle ? { line_handle: lineHandle } : {}),
      ...(heroJobId ? { hero_job_id: heroJobId } : {}),
      ...(heroClipSha256 ? { hero_clip_sha256: heroClipSha256 } : {}),
    };
    const parentBeforeSettle = lineHandle ? await lineParentGate(claim.job) : { ok: true };
    if (!parentBeforeSettle.ok) {
      verdict.ok = false;
      verdict.reason = parentBeforeSettle.reason;
      verdict.terminal = "rejected";
      verdict.line_artifact_ready = false;
    }
    const settled = await settleRebuildJob(
      jobId,
      claim.claimToken,
      parentBeforeSettle.ok ? "done" : "failed",
      verdict,
    );
    if (settled.ok === true && parentBeforeSettle.ok && verdict.ok === true && lineHandle && lineArtifactReady) {
      // Event-driven Line pickup: the waiting qualified row can now build/gate
      // the verified hero immediately. Queue failure is harmless; the existing
      // Line rescue cron remains the sweeper.
      try { await deps.wakeLineForCompletedHero(prospectId, lineHandle); } catch { /* cron recovery */ }
    }
    try {
      await deps.recordEvent("rebuild_mirror.job", {
        jobId, ok: verdict.ok, seconds, status: settled.ok ? "done" : "settle_conflict",
      });
    } catch { /* the log is observability, never a dependency */ }
    if (settled.ok === true && verdict.ok === true) {
      // The rebuild's own accounting event, one per published rebuild — the
      // same event the direct action records inline. release_id comes from the
      // engine's signed release evidence when the artifact carried it.
      const releaseEvidence = buildArtifact?.release_evidence && typeof buildArtifact.release_evidence === "object"
        ? buildArtifact.release_evidence
        : null;
      try {
        await deps.recordEvent("mirror.rebuilt", {
          prospect_id: prospectId,
          build_hash: String(verdict.build_hash || ""),
          release_id: String(releaseEvidence?.proofIdentity?.release_id || releaseEvidence?.release_id || ""),
        });
      } catch { /* the log is observability, never a dependency */ }
    }
    return { ok: true, jobId, status: "done", verdict };
  }

  /**
   * Close the dead before re-running the living: a "running" row whose lambda
   * died is requeued until its attempts run out, then closed with the verdict
   * that says so. Same order and reason as api/cron/run-edit-jobs.
   */
  async function sweepStaleRebuildJobs() {
    const read = await deps.select(
      REBUILD_JOBS_TABLE,
      `?select=*&status=eq.running&order=updated_at.asc&limit=20`,
    ).catch(() => null);
    if (!read || read.ok !== true) return { ok: true, requeued: [], closed: [] };
    const requeued = [];
    const closed = [];
    for (const raw of jobRows(read)) {
      const job = jobFromRow(raw);
      const updated = Date.parse(String(job.updatedAt || ""));
      if (!Number.isFinite(updated) || Date.parse(iso()) - updated < STALE_RUNNING_MS) continue;
      const attempts = job.attempts + 1;
      let swept;
      try {
        swept = await deps.conditionalUpdate(
          REBUILD_JOBS_TABLE,
          "job_id",
          job.jobId,
          { status: "eq.running" },
          attempts >= MAX_ATTEMPTS
            ? {
              status: "failed",
              result: {
                ok: false,
                reason: "rebuild_retry_exhausted",
                attempts,
                ...(normalizeLineHandle(job.result?.line_handle) ? { line_handle: normalizeLineHandle(job.result.line_handle) } : {}),
                ...(safeJobId(job.result?.hero_job_id) ? { hero_job_id: safeJobId(job.result.hero_job_id) } : {}),
                ...(/^[a-f0-9]{64}$/i.test(String(job.result?.hero_clip_sha256 || ""))
                  ? { hero_clip_sha256: String(job.result.hero_clip_sha256).toLowerCase() }
                  : {}),
              },
              updated_at: iso(),
            }
            : {
              status: "queued",
              attempts,
              result: normalizeLineHandle(job.result?.line_handle) || safeJobId(job.result?.hero_job_id)
                ? {
                  ...(normalizeLineHandle(job.result?.line_handle) ? { line_handle: normalizeLineHandle(job.result.line_handle) } : {}),
                  ...(safeJobId(job.result?.hero_job_id) ? { hero_job_id: safeJobId(job.result.hero_job_id) } : {}),
                  ...(/^[a-f0-9]{64}$/i.test(String(job.result?.hero_clip_sha256 || ""))
                    ? { hero_clip_sha256: String(job.result.hero_clip_sha256).toLowerCase() }
                    : {}),
                }
                : null,
              updated_at: iso(),
            },
        );
      } catch {
        swept = null;
      }
      if (swept && swept.ok === true && swept.updated === true) {
        (attempts >= MAX_ATTEMPTS ? closed : requeued).push(job.jobId);
      }
    }
    return { ok: true, requeued, closed };
  }

  /**
   * drainRebuildJobs — the cron entry point. At most `max` rebuilds per pass
   * (default 2): one rebuild is ~127s of a 300s function; anything more is a
   * promise the platform will break for us.
   */
  async function drainRebuildJobs({ max, mirrorProspect, select } = {}) {
    const limit = drainMax(max ?? process.env.GHOST_AGENCY_REBUILD_DRAIN_MAX);
    const read = await deps.select(
      REBUILD_JOBS_TABLE,
      `?select=*&status=eq.queued&order=created_at.asc&limit=${limit * 3}`,
    ).catch(() => null);
    if (!read || read.ok !== true) return { ok: false, error: "rebuild_queue_unavailable", drained: 0 };
    const runDeps = { ...(mirrorProspect ? { mirrorProspect } : {}), ...(select ? { select } : {}) };
    let drained = 0;
    let failed = 0;
    let skipped = 0;
    for (const raw of jobRows(read)) {
      if (drained >= limit) break;
      const job = jobFromRow(raw);
      const outcome = await runRebuildJob(job.jobId, runDeps);
      if (outcome.ok === true) drained += 1;
      else if (["in_flight", "already_finished"].includes(outcome.error)) skipped += 1;
      else failed += 1;
    }
    return { ok: true, drained, failed, skipped };
  }

  return {
    enqueueRebuildJob,
    getRebuildJob,
    claimRebuildJob,
    runRebuildJob,
    settleRebuildJob,
    sweepStaleRebuildJobs,
    drainRebuildJobs,
  };
}

const defaults = createRebuildJobs();

module.exports = {
  REBUILD_JOBS_TABLE,
  JOB_STATUSES,
  STALE_RUNNING_MS,
  MAX_ATTEMPTS,
  DEFAULT_DRAIN_MAX,
  INLINE_BUDGET_MS: 120_000,
  createRebuildJobs,
  newRebuildJobId,
  heroRebuildJobId,
  publicVerdict,
  durableBuildArtifact,
  lineHeroRebuildMarker,
  safeCode,
  drainMax,
  ...defaults,
};
