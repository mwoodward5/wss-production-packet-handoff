"use strict";

// Durable Line mirror adapter.
//
// This file owns one invariant that matters at 10 sites and becomes mandatory
// at 500: one durable prospect operation must mean one deterministic site
// payload. The miner already persists a fully proven MirrorRequest at
// record.build_ready.mirror_request. Re-deriving that request during every Line
// retry (fresh design brief, font capture, nearby-town research, etc.) changes
// build_hash, defeats deployment resume, and turns one website into several
// READY Vercel deployments before the row ever checkpoints.
//
// Production Line builds therefore consume that immutable mined request when it
// exists. Before the FIRST build, a missing visual identity layer may be measured
// once and CAS-frozen into that same stored request; retries then reuse the exact
// measured typography/surface/accent bytes instead of re-scraping. The only
// other additive field resolved at build time is the WSS signup panel, whose
// checkout token is week-bucketed and whose Riley/client identifiers are
// deterministic. Thin needs_fill packets still use the normal enrichment lane;
// they do not have a complete stored request to freeze.
//
// The Mirror Engine keeps a conservative checkpoint reserve. The durable Line
// owns its own persistence envelope, so only the inner deadline gets a measured
// extension. Same-operation deployment recovery remains project-bound and every
// recovered candidate still must pass byteDiff + deep-link proof before aliasing.

const adapters = require("./line-adapters");
const { resolveLineTaggedDeployment } = require("./line-tagged-resume");
const { recoverPersistedMirrorBuild, signedReleaseEvidence } = require("./line-persisted-mirror");
const { renderAuditWithRecovery } = require("./line-render-audit");
const { verificationMode } = require("./light-verification");
const { freezeVisualIdentity } = require("./line-identity-freeze");
const clientPhotoBank = require("./client-photo-bank");
const { injectDefaultSharedPublisher } = require("./shared-mirror-publisher");

const LINE_ENGINE_DEADLINE_EXTENSION_MS = 15_000;
const HERO_RECHECK_READ_UNAVAILABLE = "hero_recheck_read_unavailable";

function objectOf(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function transientHeroPark(row = {}, reason = "") {
  if (String(reason || "") !== HERO_RECHECK_READ_UNAVAILABLE) return null;
  const hero = objectOf(row.heroRemaster) || objectOf(row.hero_remaster) || {};
  const previewUrl = String(row.previewUrl || row.preview_url || "").trim();
  const buildHash = String(row.buildHash || row.build_hash || "").trim();
  const rawReleaseEvidence = objectOf(
    row.releaseEvidence
    || row.release_evidence
    || objectOf(row.buildEvidence)?.release_evidence
    || objectOf(row.build_evidence)?.release_evidence,
  );
  const jobId = String(hero.jobId || hero.job_id || "").trim();
  const attemptId = String(hero.attemptId || hero.attempt_id || hero.hero_attempt_id || "").trim();
  const operatorAction = String(hero.status || "").trim() === "operator_action_required";
  const releaseEvidence = signedReleaseEvidence(rawReleaseEvidence, previewUrl);
  if (hero.pending !== true
    || !jobId
    || (!attemptId && !operatorAction)
    || !/^https:\/\//i.test(previewUrl)
    || !/^[a-f0-9]{64}$/i.test(buildHash)
    || !releaseEvidence
    || String(releaseEvidence.build_hash || "").toLowerCase() !== buildHash.toLowerCase()) return null;
  return {
    ok: true,
    revealable: false,
    heroRemasterPending: true,
    reason: HERO_RECHECK_READ_UNAVAILABLE,
    heroRemaster: {
      ...hero,
      required: true,
      ready: false,
      pending: true,
      hold: false,
      reason: HERO_RECHECK_READ_UNAVAILABLE,
    },
    previewUrl,
    buildHash,
    releaseEvidence,
    buildEvidence: row.buildEvidence || row.build_evidence || null,
    contentSource: row.contentSource || row.content_source || "",
    currentWebsite: row.currentWebsite || row.current_website || "",
  };
}

function isMirrorDeadline(reason) {
  const text = String(reason || "").toLowerCase();
  return text.includes("mirror_deadline")
    || text.includes("caller_abort_or_checkpoint_reserve")
    || /\bstatus[_ ]?504\b/.test(text)
    // A transient 5xx while PROBING an already-created/live deployment
    // (resume_probe_retryable / fresh_probe_retryable) is retryable too: the
    // next bounded attempt re-probes the SAME tagged deployment and ships it,
    // instead of terminating a good build with its retry budget unspent.
    // Deterministic reasons — resume_refused, resume_unavailable,
    // deployment_wrong_project, bytes_differ, did_not_serve*, served_spa_shell,
    // catch_all_shadowed_asset — do NOT contain "probe_retryable" and stay terminal.
    || text.includes("probe_retryable");
}

function storedBuildReadyRequest(prospect = {}) {
  const record = objectOf(prospect.record) || {};
  const buildReady = objectOf(record.build_ready);
  const request = objectOf(buildReady && buildReady.mirror_request);
  if (!request
    || !String(request.slug || "").trim()
    || !String(request.donor || "").trim()
    || !objectOf(request.facts)
    || !objectOf(request.brand)) return null;
  // JSON clone deliberately strips prototypes/functions and guarantees the
  // request passed to the engine cannot mutate the durable prospect record.
  try { return JSON.parse(JSON.stringify(request)); } catch { return null; }
}

function weldDurableHeroMedia(request = {}, prospect = {}) {
  const { heroReelBlock } = require("./mirror-lane-build");
  const media = heroReelBlock(objectOf(prospect.record) || {});
  if (!objectOf(media.hero_video)) return request;
  return {
    ...request,
    brand: {
      ...(objectOf(request.brand) || {}),
      hero_video: media.hero_video,
    },
  };
}

function floorReason(contentFloor, serviceFloor) {
  if (serviceFloor && serviceFloor.status !== "passed") return `service_floor:${serviceFloor.verdict || "failed"}`;
  if (contentFloor && contentFloor.status !== "passed") return `content_floor:${contentFloor.verdict || "failed"}`;
  return null;
}

function nativeLineBuildResult(request, response, identityFreeze = null, { env = process.env } = {}) {
  const { contentFloorReport, serviceFloorReport, contentFloorDiagnostics } = require("./mirror-lane-build");
  const body = objectOf(response && response.body) || {};
  const content = objectOf(request.content) || {};
  // GHOST_AGENCY_LIGHT_VERIFICATION — the resumed stored-request path stamps
  // the same mode and applies the same floor rule as the dispatch paths.
  const verification = verificationMode(env);
  // Same self-describing sentence as the dispatch paths, from what the resumed
  // request itself carried: channel counts plus the photo/NAP context in hand.
  const contentFloor = contentFloorReport(content, body, contentFloorDiagnostics({
    facts: request.facts || {},
    photos: Array.isArray(request.brand && request.brand.photos) ? request.brand.photos.length : null,
  }), { verification });
  const serviceFloor = serviceFloorReport(content);
  const floorsPass = contentFloor.status === "passed" && serviceFloor.status === "passed";
  const identityMeasured = Boolean(identityFreeze && identityFreeze.measured === true);
  return {
    ok: body.ok === true,
    revealable: body.revealable === true && floorsPass,
    preview_url: String(body.preview_url || ""),
    verification,
    build_hash: String(body.build_hash || ""),
    ...(body.renderer ? { renderer: body.renderer } : {}),
    ...(body.qc_contract ? { qc_contract: body.qc_contract } : {}),
    ...(body.evidence_schema ? { evidence_schema: body.evidence_schema } : {}),
    ...(body.evidence_sha ? { evidence_sha: body.evidence_sha } : {}),
    ...(body.donor_content_hash ? { donor_content_hash: body.donor_content_hash } : {}),
    ...(body.logo_sha ? { logo_sha: body.logo_sha } : {}),
    ...(body.deploy_id ? { deploy_id: body.deploy_id } : {}),
    ...(body.deploy_url ? { deploy_url: body.deploy_url } : {}),
    release_evidence: body,
    slug: request.slug,
    donor: request.donor,
    vertical: String(request.facts && request.facts.industry || ""),
    facts: request.facts || {},
    photoCount: Array.isArray(request.brand && request.brand.photos) ? request.brand.photos.length : 0,
    contentCoverage: {
      services: Array.isArray(content.services) ? content.services.length : 0,
      reviews: Array.isArray(content.reviews) ? content.reviews.length : 0,
      hours: Array.isArray(content.hours) ? content.hours.length : 0,
    },
    status: Number(response && response.status) || 0,
    checks: { ...(body.checks || {}), content_floor: contentFloor, service_floor: serviceFloor },
    content_floor: contentFloor,
    service_floor: serviceFloor,
    error: body.error || null,
    detail: Array.isArray(body.detail) && body.detail.length ? body.detail : null,
    reason: body.ok === true ? floorReason(contentFloor, serviceFloor) : (body.error || "build_failed"),
    source: "stored_build_ready_mirror_request",
    content_source: "verified_mined_contract",
    visual_identity: identityFreeze ? {
      reason: String(identityFreeze.reason || ""),
      measured: identityMeasured,
      persisted: identityFreeze.persisted === true,
    } : { reason: "not_attempted", measured: false, persisted: false },
    provider_calls: { google: 0, firecrawl: 0, intake_genie: 0, design_brief: identityMeasured ? 1 : 0, local_research: 0 },
  };
}

async function lineEngineMirror(request, options = {}) {
  const { mirror } = require("./mirror-engine/engine");
  const runMirror = options.mirrorEngine || mirror;
  const engineOptions = { ...options };
  delete engineOptions.mirrorEngine;
  const injected = injectDefaultSharedPublisher(options.deps || {}, {
    dryRun: options.dryRun === true,
    env: options.env || process.env,
    selectDefault: runMirror === mirror,
  });
  return runMirror(request, {
    ...engineOptions,
    deps: {
      ...injected,
      renderAudit: injected.renderAudit || renderAuditWithRecovery,
      resolveTaggedDeployment: resolveLineTaggedDeployment,
    },
  });
}

async function lineBuildMirror(prospect, options = {}) {
  const runEngine = options.runEngine || lineEngineMirror;
  const resolveSignup = options.resolveSignupConfig || require("./mirror-engine/signup-floater").resolveSignupConfig;
  let frozen = prospect && prospect.needs_fill !== true ? storedBuildReadyRequest(prospect) : null;
  if (frozen) {
    // Fill the visual identity ONCE before the first mirror. If the miner already
    // froze it this is a cheap no-op; otherwise the measured result is CAS-written
    // back into record.build_ready.mirror_request so every later retry is exact.
    const freeze = options.freezeVisualIdentity || freezeVisualIdentity;
    const identity = await freeze(prospect, frozen, options).catch((error) => ({
      request: frozen,
      measured: false,
      persisted: false,
      reason: `visual_identity_freeze_failed:${String((error && error.message) || error).slice(0, 100)}`,
    }));
    if (identity && objectOf(identity.request)) frozen = identity.request;

    // The mined request is intentionally frozen, but an approved client reel
    // is a later, content-addressed truth update. Weld only the canonical
    // record's provenance-checked reel over donor stock before the rebuild.
    frozen = weldDurableHeroMedia(frozen, prospect);

    // Signup is deterministic for a durable retry: client code + Riley line are
    // stable, and checkout-links intentionally bucket time by UTC week. Keep the
    // miner's exact brand/content/facts untouched.
    if (!frozen.signup) {
      const panel = resolveSignup({ prospect, facts: frozen.facts, slug: frozen.slug });
      if (panel && panel.signup) frozen.signup = panel.signup;
    }
    // SERVICES ARE THE ONE SECTION A FROZEN ABSENCE MUST NOT FREEZE. The
    // contract's list is the miner's schema+heading harvest, which reads no
    // navigation — and in tonight's acceptance run FIVE of ten build-ready
    // leads carried an empty list while their homepages served the services in
    // plain HTML (Concrete of Houston and Keane both resolve 12 via the
    // resolver's own firstPartySite; measured 2026-08-20). One free GET fills
    // ONLY services with first_party_site provenance; a contract that already
    // holds a miner-harvested list is never overridden.
    let servicesRescued = false;
    const frozenServices = objectOf(frozen.content) && Array.isArray(frozen.content.services)
      ? frozen.content.services : [];
    if (!frozenServices.length) {
      const record = objectOf(prospect && prospect.record) || {};
      const website = String(prospect && prospect.current_website || record.current_website || record.website || "").trim();
      if (website) {
        const firstParty = options.firstPartySite || require("./mirror-engine/verified-facts").firstPartySite;
        const site = await firstParty({
          website,
          business_name: frozen.facts && frozen.facts.business_name,
          city: frozen.facts && frozen.facts.city,
          state: frozen.facts && frozen.facts.state,
          fetchImpl: options.deps && options.deps.fetchImpl,
        }).catch(() => null);
        const rescued = site && site.status === "ok" && site.observations && Array.isArray(site.observations.services)
          ? site.observations.services : [];
        if (rescued.length) {
          // The request schema is additionalProperties:false — provenance is
          // recorded on the RESULT (content_source), never on the request.
          frozen.content = { ...(objectOf(frozen.content) || {}), services: rescued };
          servicesRescued = true;
        }
      }
    }
    const response = await runEngine(frozen, options);
    const result = nativeLineBuildResult(frozen, response, identity);
    const ownedBank = clientPhotoBank.bankFromRecord(objectOf(prospect && prospect.record) || {});
    if (clientPhotoBank.bankIsFresh(ownedBank) && Array.isArray(ownedBank.photos) && ownedBank.photos.length) {
      result.owned_photo_bank = ownedBank;
    }
    if (servicesRescued) result.content_source = "verified_mined_contract+first_party_services";
    return result;
  }

  const builder = options.buildMirrorForProspect || require("./mirror-lane-build").buildMirrorForProspect;
  return builder(prospect, {
    ...options,
    deps: {
      ...(options.deps || {}),
      mirror: lineEngineMirror,
    },
  });
}

async function lineDispatchMirror(prospect, options = {}) {
  const { dispatchMirrorLane } = require("./full-run");
  return dispatchMirrorLane(prospect, {
    ...options,
    buildMirror: lineBuildMirror,
  });
}

async function mirrorProspectResumable(row, options = {}) {
  const customBaseMirror = typeof options.baseMirror === "function";
  const baseMirror = customBaseMirror ? options.baseMirror : adapters.mirrorProspect;
  const recover = typeof options.recoverPersistedMirrorBuild === "function"
    ? options.recoverPersistedMirrorBuild
    : recoverPersistedMirrorBuild;
  const forwarded = { ...options };
  delete forwarded.baseMirror;
  delete forwarded.recoverPersistedMirrorBuild;
  delete forwarded.postRecoveryHero;

  if (!customBaseMirror) {
    let recovery;
    try {
      recovery = await recover(row, {
        ...forwarded,
        operationKey: options.operationKey,
        lane: options.lane,
      });
    } catch {
      recovery = { recovered: false, retryable: true, reason: HERO_RECHECK_READ_UNAVAILABLE };
    }
    const recoveryReason = String(recovery?.reason || "");
    const recoveryReadUnavailable = recovery?.retryable === true && recoveryReason === HERO_RECHECK_READ_UNAVAILABLE
      || recoveryReason === "persisted_prospect_unavailable";
    if (recoveryReadUnavailable) {
      const parked = transientHeroPark(row, HERO_RECHECK_READ_UNAVAILABLE);
      if (parked) return parked;
    }
    if (recovery && recovery.recovered === true && recovery.build) {
      if (String(recovery.build.recovery || "") !== "persisted_signed_mirror") return recovery.build;
      const hero = objectOf(row.heroRemaster) || objectOf(row.hero_remaster) || {};
      const heroStatus = String(hero.status || hero.reason || "").toLowerCase();
      const heroNeedsContinuation = hero.required === true
        && hero.ready !== true
        && (hero.pending === true || hero.hold === true || hero.applied !== true
          || heroStatus.includes("stale_line_handle") || heroStatus.includes("line_handle_mismatch"));
      if (!heroNeedsContinuation) return recovery.build;
      const continueHero = typeof options.postRecoveryHero === "function"
        ? options.postRecoveryHero
        : adapters.mirrorProspect;
      // Hero continuation must evaluate the identity of the signed artifact we
      // just recovered, not the older qualified-row snapshot. In particular,
      // a worker crash before the Line checkpoint leaves top-level buildHash
      // and previewUrl absent even though the prospect has a verified dispatch.
      // Preserve the exact hero marker while projecting only that recovered,
      // already-validated build tuple onto the continuation input.
      const continuationRow = {
        ...row,
        previewUrl: recovery.build.previewUrl,
        buildHash: recovery.build.buildHash,
        releaseEvidence: recovery.build.releaseEvidence || row.releaseEvidence || null,
        buildEvidence: recovery.build.buildEvidence || row.buildEvidence || null,
        contentSource: recovery.build.contentSource || row.contentSource || "",
        currentWebsite: recovery.build.currentWebsite || row.currentWebsite || "",
      };
      // The signed Mirror is already complete. Re-enter only the adapter's
      // durable hero continuation; a missed hero branch must retry visibly and
      // can never dispatch a second Mirror deployment.
      const continued = await continueHero(continuationRow, {
        ...forwarded,
        dispatchMirrorLane: async () => null,
        onDispatchRefusal: (refusal) => {
          if (typeof forwarded.onDispatchRefusal === "function") forwarded.onDispatchRefusal(refusal);
        },
      });
      if (continued?.heroRemasterPending === true) {
        return {
          ...recovery.build,
          ...continued,
          ok: true,
          revealable: true,
          previewUrl: recovery.build.previewUrl,
          buildHash: recovery.build.buildHash,
          releaseEvidence: recovery.build.releaseEvidence,
          buildEvidence: recovery.build.buildEvidence,
          contentSource: recovery.build.contentSource,
          currentWebsite: recovery.build.currentWebsite,
        };
      }
      return continued;
    }
    if (recovery && recovery.terminal === true) {
      return {
        ok: false,
        reason: String(recovery.reason || "persisted_mirror_recovery_refused"),
        terminal: "rejected",
      };
    }
  }

  if (!customBaseMirror && typeof forwarded.dispatchMirrorLane !== "function") {
    forwarded.dispatchMirrorLane = lineDispatchMirror;
  }

  const deadline = Number(options.deadlineAt);
  if (Number.isFinite(deadline) && deadline > 0) {
    forwarded.deadlineAt = deadline + LINE_ENGINE_DEADLINE_EXTENSION_MS;
  }

  const result = await baseMirror(row, forwarded);
  if (result && result.ok === false && isMirrorDeadline(result.reason)) {
    const error = Object.assign(new Error(String(result.reason || "mirror_deadline_retry")), {
      code: "mirror_deadline_retry",
      retryable: true,
    });
    throw error;
  }
  return result;
}

module.exports = {
  LINE_ENGINE_DEADLINE_EXTENSION_MS,
  objectOf,
  isMirrorDeadline,
  storedBuildReadyRequest,
  weldDurableHeroMedia,
  floorReason,
  nativeLineBuildResult,
  lineEngineMirror,
  lineBuildMirror,
  lineDispatchMirror,
  mirrorProspectResumable,
};
