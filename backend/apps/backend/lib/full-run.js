"use strict";

const { boundedDetailText } = require("./detail-text");

const { createHash, randomUUID } = require("node:crypto");
const { mineLeads, isPlaceholderEmail, rowFromBuildReady } = require("./lead-miner");
const { buildCanonicalJob } = require("./packets");
const {
  callIntakeGenie,
  evidenceUrlMatchesSource,
  truthPacketFromCanonical,
} = require("./intake-genie-client");
const { outreachFromStatus } = require("./env-compat");
const { sendSequenceStep } = require("./email");
const { brandTruthFromEvidence, firstValue, prospectFromRow, prospectId, recordForPersist, verifiedBrandOf } = require("./prospects");
const { buildMirrorForProspect } = require("./mirror-lane-build");
const {
  enqueueHeroReelJob,
  legacySiteUrl: heroLegacySiteUrl,
  normalizedPhotoBank: normalizedHeroPhotoBank,
} = require("./hero-reel-job-queue");
const {
  autolineHeroProducer,
  heroAutolineEnabled,
} = require("./hero-video-policy");
const { REQUIRED_CHECKS } = require("./mirror-engine/engine");
const { verifyEvidence } = require("./mirror-engine/evidence-signature");
const { contactSendGate, normalizeEmail } = require("./contact-enrichment");
// Owner-proof email_log rows are marked, not counted: a proof to the operator
// is not a contact with the business (see emailLogExists below).
const { isOwnerProofEmailRecord } = require("./prospect-detail");

// The checks that can actually stop a reveal: the engine's own required list,
// plus the lane's content floor (mirror-lane-build ANDs it into revealable).
// Everything else in the manifest is measurement, and printing it in a refusal
// bracket buried the cause under three findings that never block.
const REQUIRED_FOR_REVEAL = new Set([...REQUIRED_CHECKS, "content_floor"]);

// PRINT ORDER IS PART OF THE DIAGNOSTIC.
//
// causeOfEachFailure used to walk `checks` in manifest order, and the manifest
// is assembled in BUILD order: customer_edits, hydration_parse, brand,
// mobile_fold, favicon, theme, donor_cruft, area_fence, token_scan, content,
// optimization_108 … with route_render and sameness assembled LAST because
// they can only be measured after the deploy. Five of the early entries
// (content=injected, optimization_108=scored, editable=archived,
// customer_edits, mobile_fold) are never `passed` BY DESIGN, so they were
// emitted first, every time, on every refusal. line-adapters/describeRefusal
// then slices the whole sentence to 900 chars — which cut the tail off exactly
// where route_render's problems[] lived. That is why 42 live failures all read
// "route_render=failed" in the gate list with no cause behind it: the cause was
// computed, joined, and then thrown away by the cap.
//
// So rank the causes before joining them. The checks that can actually stop a
// reveal print first, deploy-truth first within that (route_render/render say
// what the served page did), and the by-design measurements print last where
// the cap can take them without losing anything that explains the refusal.
const CAUSE_PRIORITY = Object.freeze([
  "route_render",
  "render",
  "routes",
  "sameness",
  "brand",
  "asset_diff",
  "deep_link",
  "alias_target",
  "hydration_parse",
  "token_scan",
  "identity_scan",
  "content_floor",
]);

function causeRank(name) {
  const explicit = CAUSE_PRIORITY.indexOf(name);
  if (explicit >= 0) return explicit;
  // A check that blocks a reveal but is not in the hand-ordered list above —
  // i.e. someone added one to REQUIRED_CHECKS — still outranks every
  // measurement. The two lists can drift; the blocking ones can never sink
  // below the non-blocking ones.
  if (REQUIRED_FOR_REVEAL.has(name)) return CAUSE_PRIORITY.length;
  return CAUSE_PRIORITY.length + 1;
}

// THE MIRROR LANE, as a build dispatcher.
//
// buildPreviewForProspect historically had exactly two build sources: a
// completed forge_job alias, or a live SiteForge dispatch. Neither is the mirror
// engine — grep this file for `mirror(` and you find zero calls, which is why a
// "Mine N" click produced SiteForge output that reads like a SaaS product while
// the polished mirror engine sat unreached. dispatchMirrorLane maps
// buildMirrorForProspect (clean donor + client photos + verified content, or a
// truthful refusal) into the same `dispatch` shape this file already consumes.
//
// GHOST_MIRROR_LANE remains an exported compatibility probe for older callers.
// buildPreviewForProspect no longer uses it as a router: every NEW preview is a
// Mirror Engine build, and a refusal stays a refusal. The only SiteForge work
// this module may still observe is an exact, already-persisted pending job read
// from the legacy reconciler; it can never POST a new SiteForge build here.
function mirrorLaneEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.GHOST_MIRROR_LANE || "").trim());
}

function blockedLeadMinerMirrorDispatch(reason = "leadminer_mirror_build_refused", detail = []) {
  return {
    mode: "mirror_lane",
    pending: false,
    fail_closed: true,
    reason,
    blocked: [reason],
    urls: {},
    buildStatus: {
      ready: false,
      renderer: MIRROR_ENGINE_RENDERER,
      required_renderer: MIRROR_ENGINE_RENDERER,
      qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      qc_passed: false,
      visual_qc_passed: false,
      blocked: [reason],
      detail: Array.isArray(detail) ? detail : [],
    },
  };
}

/**
 * Write down WHY a mirror was refused. Never throws and never changes routing —
 * a diagnostic that can fail a build is worse than no diagnostic.
 */
async function refusalEvent(buildProspect = {}, payload = {}, onRefusal = null) {
  // HAND THE CAUSE BACK TO THE CALLER TOO, not only to the event log.
  //
  // Older dispatches returned null and lib/line-adapters could only say
  // "mirror_build_not_revealable". The blocked return now carries this detail
  // too, while the callback remains useful to callers that want the exact
  // refusal synchronously. Neither channel changes routing.
  if (typeof onRefusal === "function") {
    try { onRefusal(payload); } catch { /* a diagnostic must never fail a build */ }
  }
  await event({
    type: "system.run",
    actor: "mirror_lane_dispatch",
    status: "blocked",
    payload: {
      stage: "mirror_lane_refused",
      prospect_id: buildProspect.prospect_id || buildProspect.id || "",
      business_name: buildProspect.business_name || buildProspect.name || "",
      ...payload,
    },
  }).catch(() => null);
}

/**
 * failingGateSummary — the `name=status` bracket the row and the refusal event
 * print, restricted to the checks that can actually block a reveal.
 *
 * A check that carries its own `diagnostic` (the content floor does, since
 * 2026-08-31) gets it appended in parens: `content_floor=failed(services:0,
 * reviews:0 … compiled:unverified(receipt_city_mismatch))`. Before this, two
 * Omaha plumbers died as the bare string `content_floor=failed` while the
 * check object held the verdict, the per-channel counts and the dispatch-time
 * Genie receipt outcome — none of which reached the operator's row.
 */
function failingGateSummary(checks = {}) {
  return Object.entries(checks || {})
    .filter(([k, v]) => REQUIRED_FOR_REVEAL.has(k) && (!v || v.status !== "passed"))
    .map(([k, v]) => `${k}=${(v && v.status) || "missing"}${v && v.diagnostic ? `(${v.diagnostic})` : ""}`);
}

/**
 * causeOfEachFailure — turn the evidence manifest's failing checks into the
 * sentences a human can act on, without dumping the whole manifest into the
 * event log.
 *
 * Every browser-backed check in this system already records its own cause:
 *   · render / route_render — `problems[]`, or `reason` when chromium never
 *     opened, plus `first_attempt` when the retry changed the answer,
 *   · asset_diff — `mismatches[]`,  deep_link — `failures[]`,
 *   · routes — `dead[]`,            alias_target — the mismatch it found.
 * This is the one place that had them all in hand and printed none of them.
 *
 * Returns { checkName: "…what the gate saw…" } for the failing checks only,
 * ORDERED so the checks that can actually block a reveal come first — see
 * CAUSE_PRIORITY. Callers join this into one capped sentence, so whatever
 * lands last is the part that gets cut.
 */
function causeOfEachFailure(checks = {}) {
  const ranked = Object.entries(checks)
    .map(([name, check], index) => ({ name, check, index }))
    .sort((left, right) => (causeRank(left.name) - causeRank(right.name)) || (left.index - right.index));
  const out = {};
  for (const { name, check } of ranked) {
    if (check && check.status === "passed") continue;
    if (!check) { out[name] = "check missing from the evidence manifest"; continue; }
    const parts = [];
    if (Array.isArray(check.problems) && check.problems.length) parts.push(check.problems.slice(0, 6).map((problem) => boundedDetailText(problem)).join(" | "));
    if (check.reason) parts.push(boundedDetailText(check.reason));
    for (const [field, label] of [["mismatches", "mismatches"], ["failures", "failures"], ["dead", "dead links"], ["errors", "errors"]]) {
      const list = check[field];
      if (Array.isArray(list) && list.length) {
        parts.push(`${label}: ${list.slice(0, 4).map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ")}`);
      }
    }
    // A retry that flipped the verdict is the single most useful thing in this
    // record: it says the failure was TIMING, not the page — which is the exact
    // distinction the 3/10 run had no way to express.
    if (check.first_attempt) {
      const fa = check.first_attempt;
      parts.push(`first attempt ${fa.status}: ${(fa.problems || []).map((problem) => boundedDetailText(problem)).join(" | ") || boundedDetailText(fa.reason) || "no detail"}`);
    }
    // THE BRAND CHECK KEEPS ITS CAUSE IN NAMED FIELDS, not in problems[].
    //
    // Just Air LLC's refusal read `brand: status=unbranded with no recorded
    // cause` while logo="client", accent="donor-default" and
    // accent_origin="unmeasurable" were all sitting in the very object this
    // function was handed. Those three fields say the whole thing: the mark is
    // theirs and the colour could not be measured from it.
    if (name === "brand") {
      const brandBits = ["logo", "accent", "accent_origin", "fonts"]
        .filter((field) => check[field])
        .map((field) => `${field}=${check[field]}`);
      if (brandBits.length) parts.push(brandBits.join(", "));
    }
    out[name] = parts.length ? parts.join(" ;; ").slice(0, 700) : `status=${check.status} with no recorded cause`;
  }
  return out;
}

// THE COUTURE HERO PRE-BUILD, opt-in and fail-soft. When
// GHOST_AGENCY_HERO_REEL_PREBUILD is on, try to compose a hero reel from the
// prospect's own banked photographs BEFORE the request is assembled —
// heroReelBlock reads record.media_bank.hero_reel at request assembly, never
// after, so this is the one moment a reel can still make this build.
//
// OFF BY DEFAULT because of the runtime constraint at lib/hero-compose.js:82-96:
// ffmpeg is not in the Vercel lambda, so on serverless the runner's probe
// answers "ffmpeg_unavailable" in one spawn attempt and the build proceeds on
// the donor fallback-clip ladder exactly as today. On the local forge /
// Chromium host — where ffmpeg exists — the flag turns first builds couture.
// ANY failure (probe, photos, encode, upload, even a crash in the runner
// module itself) leaves the original record untouched; nothing here may cost
// a build its mirror.
//
// 2026-08-21: this hook is now ONE OF THE TWO explicit opt-ins into the
// retired ffmpeg slideshow (the other is
// POST /api/admin/hero-reel { producer:"hero_compose_local" }). The default
// producer for the hero rung is the Ads Station — see
// lib/hero-reel-orchestrator.js. That lane is deliberately NOT wired in here:
// it scans the client's LEGACY site, so it has no dependency on this build and
// belongs upstream of it, started the moment a prospect qualifies and joined
// whenever it finishes. A build must never wait minutes on a browser tab.
function heroReelPrebuildEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.GHOST_AGENCY_HERO_REEL_PREBUILD || "").trim());
}

async function recordWithPreBuiltHeroReel(buildProspect, opts = {}) {
  const record = buildProspect.record;
  try {
    // Lazy require: the runner (and its ffmpeg probe) never loads unless the
    // owner opted in. Injectable so the hook is testable without Module._load.
    const reelRunner = opts.heroReelRunner || require("./hero-reel-runner");
    const made = await reelRunner.ensureHeroReel(
      { prospect_id: buildProspect.prospect_id || buildProspect.id, record },
      {},
    );
    if (!made || made.ok !== true) return record;
    const reel = {
      url: made.url,
      generator: made.generator,
      composed_from: made.composed_from,
      composed_at: made.composed_at,
    };
    // Persist for every FUTURE build, best-effort; this build does not depend
    // on the write landing — the in-memory record below is what it reads.
    if (made.reused !== true) {
      await reelRunner.patchHeroReel(buildProspect.prospect_id || buildProspect.id, reel).catch(() => {});
    }
    const base = record && typeof record === "object" ? record : {};
    const mediaBank = base.media_bank && typeof base.media_bank === "object" ? base.media_bank : {};
    return { ...base, media_bank: { ...mediaBank, hero_reel: reel } };
  } catch {
    return record;
  }
}

// THE AUTOMATIC HERO-REMASTER START. This is deliberately separate from the
// retired ffmpeg prebuild above: it writes one durable desktop-worker job and
// returns. Google, Chrome, image editing, animation, clip upload and the later
// rebuild all happen off this request. A queue refusal can never become a
// mirror refusal.
//
// Keep the exported compatibility name, but let the shared video policy own
// every automatic-line kill switch. This includes the published misspelling,
// the corrected spelling, and the broader autoline switch.
function heroRemasterEnabled(env = process.env) {
  return heroAutolineEnabled(env);
}

function heroVerticalForBuild(buildProspect = {}) {
  const record = isObject(buildProspect.record) ? buildProspect.record : {};
  const buildReadyFacts = isObject(record?.build_ready?.mirror_request?.facts)
    ? record.build_ready.mirror_request.facts
    : {};
  const mirrorFacts = isObject(record?.mirror_request?.facts) ? record.mirror_request.facts : {};
  const truthCategory = buildProspect?.truth_packet?.identity?.category?.value
    || record?.truth_packet?.identity?.category?.value
    || "";
  return firstValue(buildProspect, ["industry", "category", "primary_type"])
    || firstValue(record, ["industry", "category", "primary_type"])
    || firstValue(buildReadyFacts, ["industry", "category", "primary_type"])
    || firstValue(mirrorFacts, ["industry", "category", "primary_type"])
    || String(truthCategory || "").trim();
}

function heroRemasterEnqueueTimeoutMs(env = process.env) {
  const parsed = Number.parseInt(String(env.GHOST_AGENCY_HERO_ENQUEUE_TIMEOUT_MS || "1500"), 10);
  if (!Number.isFinite(parsed)) return 1500;
  return Math.max(250, Math.min(parsed, 3000));
}

/**
 * Enqueue only the durable job record. Awaiting this small write prevents a
 * serverless freeze from losing the job; it never waits for Google or a local
 * browser. The queue owns prospect-level idempotency, so retries reuse the
 * same job instead of making a second generation.
 */
async function enqueueHeroRemasterForBuild(buildProspect = {}, options = {}) {
  if (options.dryRun === true) return { ok: true, queued: false, skipped: "dry_run" };
  if (options.persist === false) return { ok: true, queued: false, skipped: "persistence_disabled" };
  const env = options.env || process.env;
  const producer = autolineHeroProducer(env, heroVerticalForBuild(buildProspect));
  if (!producer) {
    return { ok: true, queued: false, skipped: "disabled" };
  }

  const enqueue = options.enqueueHeroReelJob || enqueueHeroReelJob;
  try {
    const now = typeof options.now === "function" ? options.now : Date.now;
    const localDeadline = Number(now()) + heroRemasterEnqueueTimeoutMs(options.env || process.env);
    const ownerDeadline = finiteDeadline(options.deadlineAt);
    const deadlineAt = ownerDeadline ? Math.min(ownerDeadline, localDeadline) : localDeadline;
    const attempt = await runBeforeDeadline(
      (signal) => enqueue(buildProspect, {
        actor: "full_run",
        producer,
        vertical: heroVerticalForBuild(buildProspect),
        env,
        signal,
        deadlineAt,
        ...(options.lineHandle ? { lineHandle: options.lineHandle } : {}),
        ...(options.reofferBuildHash ? { reofferBuildHash: options.reofferBuildHash } : {}),
        ...(options.expectedStaleJobSnapshot ? { expectedStaleJobSnapshot: options.expectedStaleJobSnapshot } : {}),
      }),
      deadlineAt,
      now,
    );
    if (attempt.expired) {
      return { ok: false, queued: false, reason: "hero_remaster_enqueue_timeout" };
    }
    const result = attempt.value;
    if (!result || result.ok !== true) {
      return {
        ok: false,
        queued: false,
        reason: boundedDetailText(result?.reason || result?.error || "hero_remaster_enqueue_refused"),
      };
    }
    return {
      ok: true,
      queued: result.queued === true,
      reused: result.reused === true,
      job_id: String(result.job_id || result.jobId || ""),
      generation_revision: Number.isSafeInteger(Number(result.generation_revision))
        ? Number(result.generation_revision)
        : 0,
    };
  } catch {
    return { ok: false, queued: false, reason: "hero_remaster_enqueue_failed" };
  }
}

/**
 * Accept only the first-party photo bank that the completed Mirror build
 * actually harvested. The durable hero queue owns this same provenance
 * contract; running its normalizer here prevents a build result from widening
 * what that queue will later accept (foreign found_on host, stale bank,
 * unpinned GBP image, missing SHA, or a WSS mirror as source).
 */
function completedOwnedHeroBank(dispatch = {}, record = {}, at = new Date()) {
  const candidate = dispatch && dispatch.owned_photo_bank;
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.photos)) return null;
  const candidateRecord = { ...(record && typeof record === "object" ? record : {}), photo_bank: candidate };
  const source = heroLegacySiteUrl(candidateRecord);
  if (!source.ok) return null;
  const bank = normalizedHeroPhotoBank(candidateRecord, source.url, at);
  return bank.fresh && bank.photos.length ? bank : null;
}

function heroRemasterJobExists(result = {}) {
  return result && result.ok === true && (
    result.queued === true
    || result.reused === true
    || Boolean(String(result.job_id || result.jobId || "").trim())
  );
}

async function dispatchMirrorLane(buildProspect, opts = {}) {
  const build = opts.buildMirror || buildMirrorForProspect;
  const leadMinerPacket = isLeadMinerMirrorReadyPacket(
    buildProspect.truth_packet,
    buildProspect.truth_packet_source,
  );
  // A dry run makes zero network calls by contract — the reel composer would
  // break that promise, so the hook only runs on real dispatches.
  const recordForBuild = heroReelPrebuildEnabled() && opts.dryRun !== true
    ? await recordWithPreBuiltHeroReel(buildProspect, opts)
    : buildProspect.record;
  const out = await build({
    prospect_id: buildProspect.prospect_id || buildProspect.id,
    business_name: buildProspect.business_name || buildProspect.name,
    industry: buildProspect.industry,
    city: buildProspect.city,
    state: buildProspect.state,
    marketing_city: buildProspect.marketing_city,
    current_website: buildProspect.current_website || buildProspect.website,
    email: buildProspect.email,
    place_id: buildProspect.place_id,
    logo: buildProspect.logo_url || buildProspect.logo,
    // The accent the miner measured from that same logo, and where from. Only
    // ever used when this runtime cannot decode the bytes itself — without it,
    // every JPEG/WebP mark refuses its own mirror as brand=unbranded.
    logo_accent: buildProspect.logo_accent,
    logo_accent_source: buildProspect.logo_accent_source,
    // Google-observed NAP from the mined contract. Without the phone the
    // donor's call CTAs collapse and the render gate rightly fails nap_match.
    phone: buildProspect.phone,
    rating: buildProspect.rating,
    review_count: buildProspect.review_count,
    // The mined contract's verified facts and content, whole. This whitelist is
    // deliberately narrow — but narrowing it to scalars is exactly what dropped
    // the contract's coordinates, address and place_id on every console-mined
    // lead, so the two verified blocks travel as blocks.
    verified_facts: buildProspect.verified_facts,
    verified_content: buildProspect.verified_content,
    // The row itself, so the fact resolver's cachedProspectRow source has
    // something to observe instead of reporting `not_supplied` forever.
    // (With the opt-in pre-build above, this may carry a freshly composed
    // media_bank.hero_reel; otherwise it is buildProspect.record verbatim.)
    record: recordForBuild,
    truth_packet: buildProspect.truth_packet,
    truth_packet_source: buildProspect.truth_packet_source,
    // NEEDS_FILL — the whole AI-fill feature was inert without this one line.
    //
    // line-adapters/mirrorProspect flags a thin-but-real LeadMiner packet
    // `dispatchProspect.needs_fill = true`, then dispatches through here. This
    // whitelist is deliberately narrow, and it silently dropped that flag on the
    // floor: buildMirrorForProspect reads prospect.needs_fill (and only falls
    // back to record/truth_packet), so with the top-level flag gone every
    // needs_fill packet arrived at the builder unflagged and was refused as
    // `leadminer_truth_packet_incomplete` — the exact "feature is inert in
    // production" the audit named. Carry it, and the fill path runs.
    needs_fill: buildProspect.needs_fill === true ? true : undefined,
    composition_slot: buildProspect.composition_slot,
  }, {
    dryRun: opts.dryRun === true,
    // Preserve the caller's delivery boundary. Sandbox is the owner-only
    // Practice lane, and the Mirror fleet reader uses that fact to avoid
    // turning unrelated legacy identity enrichment into a global build hold.
    lane: opts.lane,
    operationKey: opts.operationKey,
    signal: opts.signal,
    deadlineAt: opts.deadlineAt,
  });

  // A refusal (no clean donor, retired vertical, or invalid client evidence)
  // fails CLOSED. It used to return null, and buildPreviewForProspect treated
  // null as permission to create a fresh SiteForge build. That side door made
  // the selected renderer depend on which validation failed. Return a truthful
  // blocked Mirror shape instead; callers still receive the engine's exact
  // reason and can never reinterpret a refusal as fallback authorization.
  if (!out || out.ok === false) {
    const reason = out?.reason || out?.error || "mirror_engine_build_refused";
    const detail = out?.detail || out?.missing || null;
    if (out?.disposition === "system_hold" && out?.retryable === true && out?.lead_rejection === false) {
      const rawSystemHold = isObject(out.system_hold) ? out.system_hold : {};
      const reconciliation = isObject(out.reconciliation)
        ? out.reconciliation
        : isObject(rawSystemHold.reconciliation)
          ? rawSystemHold.reconciliation
          : null;
      const releaseEvidence = isObject(out.release_evidence)
        ? out.release_evidence
        : isObject(out.deployed_release_evidence)
          ? out.deployed_release_evidence
          : null;
      const manualReconciliationRequired = out.manual_reconciliation_required === true
        || rawSystemHold.manual_reconciliation_required === true
        || rawSystemHold.scope === "mirror_reconciliation";
      const providerAttempted = out.provider_attempted === true || manualReconciliationRequired;
      return {
        mode: "mirror_lane_system_hold",
        pending: true,
        fail_closed: true,
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        reason,
        system_hold: out.system_hold || null,
        provider_attempted: providerAttempted,
        manual_reconciliation_required: manualReconciliationRequired,
        rebuild_allowed: manualReconciliationRequired ? false : undefined,
        redeploy_allowed: manualReconciliationRequired ? false : undefined,
        ...(reconciliation ? { reconciliation } : {}),
        ...(releaseEvidence ? { release_evidence: releaseEvidence } : {}),
        jobId: opts.operationKey || null,
        blocked: [reason],
        urls: {},
        buildStatus: {
          ready: false,
          pending: true,
          retryable: true,
          disposition: "system_hold",
          lead_rejection: false,
          renderer: MIRROR_ENGINE_RENDERER,
          required_renderer: MIRROR_ENGINE_RENDERER,
          qc_contract: MIRROR_ENGINE_QC_CONTRACT,
          required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
          qc_passed: false,
          visual_qc_passed: false,
          blocked: [reason],
          detail: Array.isArray(detail) ? detail : detail ? [detail] : [],
        },
      };
    }
    await refusalEvent(buildProspect, {
      reason,
      detail,
      status: out?.status || null,
      leadMinerPacket,
    }, opts.onRefusal);
    // The engine's field-level detail (or the packet's missing-fact list)
    // rides on the blocked shape too, so a caller that did not wire onRefusal
    // still has the actionable cause.
    return blockedLeadMinerMirrorDispatch(reason, Array.isArray(detail) ? detail : detail ? [detail] : []);
  }
  if (!out.revealable || !/^https:\/\//i.test(out.preview_url || "")) {
    // A DRY RUN IS NOT A REFUSAL. computeRevealable requires `passed` on every
    // named check, and a dry run deliberately marks five of them
    // "skipped_dry_run" — asset_diff, deep_link, alias_target, render,
    // route_render — because it makes zero Vercel calls. So `revealable:false`
    // is the CORRECT answer for a dry run, and logging it here wrote four
    // businesses into the refusal tally for having done exactly what was asked.
    // It is not a deploy and cannot be marked ready, but its signed manifest is
    // still valuable proof that the engine ran. Preserve that native evidence
    // without logging a refusal or falling into another renderer.
    if (opts.dryRun === true) {
      const evidence = out.release_evidence || out.manifest || null;
      return {
        mode: "mirror_lane_dry_run",
        dry_run: true,
        pending: false,
        fail_closed: true,
        reason: "dry_run_makes_no_reveal",
        blocked: ["dry_run_makes_no_reveal"],
        urls: {},
        build_hash: out.build_hash || evidence?.build_hash || "",
        renderer: out.renderer || evidence?.renderer || MIRROR_ENGINE_RENDERER,
        qc_contract: out.qc_contract || evidence?.qc_contract || MIRROR_ENGINE_QC_CONTRACT,
        evidence_schema: out.evidence_schema || evidence?.evidence_schema || MIRROR_ENGINE_EVIDENCE_SCHEMA,
        evidence_sha: out.evidence_sha || evidence?.evidence_sha || "",
        release_evidence: evidence,
        releaseEvidence: evidence,
        truth_packet: out.truth_packet || buildProspect.truth_packet || null,
        jobId: opts.operationKey || null,
        buildStatus: {
          ready: false,
          pending: false,
          renderer: out.renderer || evidence?.renderer || MIRROR_ENGINE_RENDERER,
          required_renderer: MIRROR_ENGINE_RENDERER,
          qc_contract: out.qc_contract || evidence?.qc_contract || MIRROR_ENGINE_QC_CONTRACT,
          required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
          evidence_schema: out.evidence_schema || evidence?.evidence_schema || MIRROR_ENGINE_EVIDENCE_SCHEMA,
          evidence_sha: out.evidence_sha || evidence?.evidence_sha || "",
          release_evidence: evidence,
          qc_passed: false,
          visual_qc_passed: false,
          blocked: ["dry_run_makes_no_reveal"],
          generation_fingerprint: out.build_hash || evidence?.build_hash
            ? `mirror-engine:${out.build_hash || evidence.build_hash}`
            : null,
        },
      };
    }
    await refusalEvent(buildProspect, {
      reason: "not_revealable",
      // The named gates that did not pass — the whole point of the evidence
      // manifest is that this question has a recorded answer.
      //
      // FILTERED TO THE CHECKS THAT ACTUALLY BLOCK. This read "every check whose
      // status is not passed", and three checks are never `passed` by design:
      // content=injected, optimization_108=scored, editable=archived. Tallied
      // across 5,794 system.run events, they appeared on 41 to 45 of the 45
      // refusals each — so every dead lead wore a bracket of three findings that
      // had nothing to do with why it died, and the operator had to know which
      // names to ignore. computeRevealable owns the real list; ask it, so the
      // two can never disagree.
      detail: failingGateSummary(out.checks || {}),
      // WHY, not just WHICH.
      //
      // For two ten-lead runs every casualty in this log read exactly
      // `render=failed` — a LABEL, with the cause thrown away one line above.
      // checks.render already held the browser's own words (problems[],
      // reason, failed_requests, page_errors); nothing recorded them, so the
      // question "what actually broke" had no answer anywhere in the system
      // and had to be re-derived by hand from live URLs.
      //
      // A status is what a gate decided. This is what it SAW.
      cause: causeOfEachFailure(out.checks || {}),
      preview_url: out.preview_url || "",
      leadMinerPacket,
    }, opts.onRefusal);
    return blockedLeadMinerMirrorDispatch(
      leadMinerPacket ? "leadminer_mirror_not_revealable" : "mirror_engine_not_revealable",
      failingGateSummary(out.checks || {}),
    );
  }

  return {
    mode: "mirror_lane",
    pending: false,
    urls: { preview_url: out.preview_url, report_url: "" },
    // LIGHT vs FULL verification (GHOST_AGENCY_LIGHT_VERIFICATION) — carried
    // from the build result onto the dispatch, the row and telemetry, so a
    // shipped site can always be audited for which verification produced it.
    verification: out.verification || "full",
    // The engine's identity for THIS build. Rides out so a proof shot taken of
    // this page can record which build it is a picture of — see
    // lib/line-proof-shots and lib/line-email-assets.
    build_hash: out.build_hash || "",
    // Preserve the Mirror Engine's signed native evidence. Relabelling this as
    // SiteForge/Forge made a real Mirror build unverifiable at the send gate.
    renderer: out.renderer || MIRROR_ENGINE_RENDERER,
    qc_contract: out.qc_contract || MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: out.evidence_schema || MIRROR_ENGINE_EVIDENCE_SCHEMA,
    evidence_sha: out.evidence_sha || "",
    release_evidence: out.release_evidence || out.manifest || null,
    releaseEvidence: out.release_evidence || out.manifest || null,
    jobId: opts.operationKey || null,
    // The star rating the page went out with, and which observation it is. Rides
    // out so the render gate can be pointed at the build's own reading; see
    // line-adapters.sourceFactsFor.
    published_aggregate: out.published_aggregate || null,
    // The photo bank may have been born inside this build (the harvester runs
    // after the early hero-job attempt). Carry it to the completion writer so
    // the durable remaster worker can receive the exact owned image instead of
    // every first build silently falling back to the donor's stock reel.
    ...(out.owned_photo_bank ? { owned_photo_bank: out.owned_photo_bank } : {}),
    photo_accounting: (out.checks && out.checks.brand && out.checks.brand.photos && typeof out.checks.brand.photos === "object")
      ? out.checks.brand.photos
      : null,
    content_source: out.content_source || "verified",
    needs_fill: out.needs_fill === true,
    buildStatus: {
      ready: true,
      renderer: out.renderer || MIRROR_ENGINE_RENDERER,
      verification: out.verification || "full",
      required_renderer: MIRROR_ENGINE_RENDERER,
      qc_contract: out.qc_contract || MIRROR_ENGINE_QC_CONTRACT,
      required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      evidence_schema: out.evidence_schema || MIRROR_ENGINE_EVIDENCE_SCHEMA,
      evidence_sha: out.evidence_sha || "",
      release_evidence: out.release_evidence || out.manifest || null,
      qc_passed: true,
      visual_qc_passed: true,
      blocked: [],
      generation_fingerprint: out.build_hash
        ? `mirror-engine:${out.build_hash}`
        : `mirror-lane:${out.slug}`,
      mirror: {
        donor: out.donor,
        vertical: out.vertical,
        photos: out.photoCount,
        content: out.contentCoverage,
        // Photos the pre-validation URI sanitizer dropped (whitespace,
        // data:/relative, duplicates) — the gallery that didn't travel.
        ...(out.brand_photos_dropped_invalid ? { photos_dropped_invalid: out.brand_photos_dropped_invalid } : {}),
        // The over-cap about note: rich source copy was portioned to the
        // schema cap, never a refusal (lib/intake-packet mergeIntoContent).
        ...(out.about_compressed_to_cap ? { about_compressed_to_cap: out.about_compressed_to_cap } : {}),
      },
    },
  };
}
const { sanitizePreviewUrl } = require("./preview-host-guard");
const { AUTOSEND_KEY, abandonPendingAutosend } = require("./autosend");
const { recordedPositivePreviewConsent } = require("./preview-consent");
const {
  REQUIRED_QC_CONTRACT,
  REQUIRED_RENDERER,
  CANONICAL_SITEFORGE_BUILD_URL,
  FORGE_MIRROR_RENDERER,
  FORGE_MIRROR_QC_CONTRACT,
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
  acceptedRendererPair,
} = require("./siteforge");
const { conditionalUpdate, event, select, upsertRow } = require("./store");
const { approvedIndustry } = require("./copilot");
const { ownerSandboxAddress, forceOwnerRecipient, assertOwnerOnly } = require("./sandbox-send");

const OWNER_PROOF_REQUEST_WINDOW_MS = 285_000;
const OWNER_PROOF_FINALIZE_RESERVE_MS = 45_000;
const OWNER_PROOF_SEND_START_MIN_MS = 1_000;
const OWNER_PROOF_AUDIT_TIMEOUT_MAX_MS = 500;
const MIRROR_REVEAL_CLAIM_KEY = "mirror_build_claim";
const MIRROR_REVEAL_CLAIM_LEASE_MS = 15 * 60 * 1000;

function sameInstant(left, right) {
  const leftMs = Date.parse(String(left || ""));
  const rightMs = Date.parse(String(right || ""));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonValue).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalJson(value) {
  // Compare and hash the contract that can actually cross the PostgREST JSON
  // boundary. JSON omits undefined/function/symbol object properties, maps
  // those array entries to null, applies toJSON, and normalizes non-finite
  // numbers to null. Canonicalizing the richer in-memory object made an exact
  // returned row look different from the patch that produced it.
  const wire = JSON.stringify(value);
  return wire === undefined ? undefined : canonicalJsonValue(JSON.parse(wire));
}

function mirrorBuildSourceFingerprint(buildProspect = {}) {
  const rawRecord = isObject(buildProspect.record) ? buildProspect.record : {};
  const record = { ...rawRecord };
  const outputBrandTruthPresent = isObject(rawRecord.brand_truth);
  const sourceOnlyBrandRecord = outputBrandTruthPresent ? { ...rawRecord } : null;
  if (sourceOnlyBrandRecord) delete sourceOnlyBrandRecord.brand_truth;
  const sourceOnlyBrand = sourceOnlyBrandRecord
    ? verifiedBrandOf({ ...buildProspect, record: sourceOnlyBrandRecord })
    : null;
  // recordForPersist copies normalized top-level inputs into JSONB. Strip those
  // duplicate copies on replay; their canonical value is already present at
  // the top level of this exact build contract.
  for (const key of Object.keys(buildProspect)) {
    if (key !== "record") delete record[key];
  }
  for (const key of [
    "status",
    "created_at",
    "updated_at",
    "report_url",
    "preview_url",
    "preview_expires_at",
    "checkout_url",
    "build_dispatch",
    "legacy_build_dispatch",
    "forge_job",
    "siteforge_qc_passed",
    "siteforge_visual_qc_passed",
    "siteforge_qc_contract",
    "siteforge_renderer",
    "siteforge_generation_fingerprint",
    "siteforge_callback",
    "release_evidence",
    "blocked_reason",
    "contact_hold_reason",
    "suppression_reason",
    "do_not_contact",
    "suppressed",
    "contact_suppressed",
    "email_suppressed",
    "outreach_review_hold",
    "contact_enrichment",
    "outreach",
    "packets",
    "preview_build_consent",
    "brand_truth",
    "authority_summary",
    "optimization_manifest_url",
    AUTOSEND_KEY,
    MIRROR_REVEAL_CLAIM_KEY,
  ]) delete record[key];
  const source = { ...buildProspect, record };
  delete source.preview_url;
  // Consent authorizes the build but does not change the rendered artifact.
  // Re-stamping the same granted consent must not mint a second provider key.
  delete source.preview_build_consent;
  if (sourceOnlyBrand) {
    // brand_truth is output from a prior release. verifiedBrandOf correctly
    // promotes that shipped colour for presentation, but it cannot become new
    // source identity and rotate the provider receipt. Reconstruct the accent
    // from the pre-output mined/owner evidence while hashing only.
    source.logo_accent = sourceOnlyBrand.accent || "";
    source.logo_accent_source = sourceOnlyBrand.accent_source || "";
  }
  // The operation receipt already binds the composition slot separately. Its
  // persisted JSONB copy moves from top-level to record on replay, so including
  // it here would make an unchanged held build look like a source revision.
  delete source.composition_slot;
  delete record.composition_slot;
  if (isObject(source.truth_packet)) {
    const packetMeta = isObject(source.truth_packet.meta) ? { ...source.truth_packet.meta } : {};
    // Intake's projection stamps these afresh on every equivalent compile.
    // They do not change rendered truth and must not mint a new provider
    // receipt after an uncertain persistence response.
    for (const key of ["generated_at", "job_id", "request_id", "compiled_at"]) delete packetMeta[key];
    const canonicalIntake = isObject(source.truth_packet.intakeGenie)
      ? { ...source.truth_packet.intakeGenie }
      : null;
    if (canonicalIntake) {
      // truthPacketFromCanonical embeds the compiler's complete packet here.
      // These shallow request/run receipts change on an equivalent recompile;
      // facts, evidence, assets, content and version remain source identity.
      for (const key of [
        "job_id",
        "request_id",
        "run_id",
        "generated_at",
        "requested_at",
        "started_at",
        "completed_at",
        "compiled_at",
      ]) delete canonicalIntake[key];
    }
    source.truth_packet = {
      ...source.truth_packet,
      meta: packetMeta,
      ...(canonicalIntake ? { intakeGenie: canonicalIntake } : {}),
    };
  }
  // This is the normalized contract passed to Mirror (including branding,
  // facts, reviews, geo, services and packet evidence), minus only lifecycle
  // and build-output bookkeeping. A real input revision rotates the receipt;
  // persisting the reconciliation hold does not.
  const basis = { schema: "wss.mirror.build_source.v1", source };
  return createHash("sha256").update(canonicalJson(basis)).digest("hex");
}

function stableMirrorBuildOperationKey({ prospectId: id, sourceFingerprint, compositionSlot } = {}) {
  // The request id must survive an uncertain final DB write. A timestamp-based
  // job id lets the next reveal poll create a second deployment after the first
  // one published but its reconciliation hold failed to persist. The receipt is
  // the logical site identity only: mutable row bookkeeping (updated_at,
  // status, build_dispatch) must not rotate it after a hold write. Mirror's
  // tagged-deployment resolver also requires the exact build_hash, so a real
  // source/build change cannot reuse the wrong release.
  const basis = {
    schema: "wss.mirror.build_operation.v1",
    prospect_id: String(id || "").trim(),
    source_fingerprint: String(sourceFingerprint || "").trim(),
    composition_slot: Number.isInteger(compositionSlot) && compositionSlot >= 0 ? compositionSlot : null,
  };
  return `mirror_build:${createHash("sha256").update(canonicalJson(basis)).digest("hex")}`;
}

function exactMirrorReconciliationEvidence({ prospectId: id, reconciliation, releaseEvidence } = {}) {
  if (!isObject(reconciliation)
    || reconciliation.schema !== "wss.mirror.fleet_reconciliation.v1"
    || reconciliation.redeploy_allowed !== false
    || !isObject(reconciliation.release)
    || !isObject(reconciliation.fleet_identity)
    || !isObject(releaseEvidence)) {
    return false;
  }
  const release = reconciliation.release;
  const fleet = reconciliation.fleet_identity;
  const proof = isObject(releaseEvidence.proofIdentity)
    ? releaseEvidence.proofIdentity
    : isObject(releaseEvidence.proof_identity)
      ? releaseEvidence.proof_identity
      : null;
  const proofExact = proof
    ? isObject(release.proof_identity)
      && canonicalJson(release.proof_identity) === canonicalJson(proof)
    : !Object.hasOwn(release, "proof_identity");
  let deployUrlValid = false;
  try {
    const deployUrl = new URL(String(releaseEvidence.deploy_url || ""));
    deployUrlValid = deployUrl.protocol === "https:" && !deployUrl.username && !deployUrl.password;
  } catch (_) {
    deployUrlValid = false;
  }
  if (!verifyEvidence(releaseEvidence)
    || !String(releaseEvidence.deploy_id || "").trim()
    || !deployUrlValid
    || release.build_hash !== releaseEvidence.build_hash
    || release.preview_url !== releaseEvidence.preview_url
    || release.deploy_id !== releaseEvidence.deploy_id
    || release.deploy_url !== releaseEvidence.deploy_url
    || release.evidence_sha !== releaseEvidence.evidence_sha
    || !proofExact
    || fleet.prospect_id !== String(id || "").trim()
    || fleet.slug !== releaseEvidence.slug
    || fleet.donor !== releaseEvidence.donor
    || fleet.build_hash !== releaseEvidence.build_hash) {
    return false;
  }
  return true;
}

function durableMirrorReconciliationFence(prospect = {}) {
  const id = prospectId(prospect);
  const record = isObject(prospect.record) ? prospect.record : {};
  const dispatch = isObject(record.build_dispatch) ? record.build_dispatch : {};
  const hold = isObject(dispatch.system_hold) ? dispatch.system_hold : {};
  const reconciliation = isObject(dispatch.reconciliation)
    ? dispatch.reconciliation
    : isObject(hold.reconciliation)
      ? hold.reconciliation
      : null;
  const releaseEvidence = isObject(dispatch.release_evidence)
    ? dispatch.release_evidence
    : isObject(record.release_evidence)
      ? record.release_evidence
      : null;
  const typed = String(prospect.status || "").trim() === "held"
    && String(record.status || "").trim() === "held"
    && dispatch.disposition === "system_hold"
    && dispatch.lead_rejection === false
    && dispatch.provider_attempted === true
    && dispatch.manual_reconciliation_required === true
    && dispatch.redeploy_allowed === false
    && /^[a-f0-9]{64}$/.test(String(dispatch.source_fingerprint || ""))
    && dispatch.source_fingerprint === mirrorBuildSourceFingerprint(prospectBuildInput(
      prospect,
      isObject(prospect.truth_packet)
        ? prospect.truth_packet
        : isObject(record.truth_packet)
          ? record.truth_packet
          : {},
    ))
    && hold.scope === "mirror_reconciliation"
    && hold.manual_reconciliation_required === true
    && reconciliation?.redeploy_allowed === false;
  if (!typed) return null;
  return {
    valid: exactMirrorReconciliationEvidence({
      prospectId: id,
      reconciliation,
      releaseEvidence,
    }),
    dispatch,
    hold,
    reconciliation,
    releaseEvidence,
  };
}

function reconciliationWriteGuards(prospect = {}) {
  const version = String(prospect.updated_at || "").trim();
  const status = String(prospect.status || "").trim();
  if (!version || !status) return null;
  const record = isObject(prospect.record) ? prospect.record : {};
  const consent = isObject(record.preview_build_consent) ? record.preview_build_consent : {};
  const enrichment = isObject(record.contact_enrichment) ? record.contact_enrichment : {};
  const outreach = isObject(enrichment.outreach) ? enrichment.outreach : {};
  return {
    updated_at: `eq.${version}`,
    status: `eq.${status}`,
    email: postgrestScalarGuard(prospect.email),
    owner_email: postgrestScalarGuard(prospect.owner_email),
    "record->>status": postgrestScalarGuard(record.status),
    "record->>email": postgrestScalarGuard(record.email),
    "record->>owner_email": postgrestScalarGuard(record.owner_email),
    "record->>ownerEmail": postgrestScalarGuard(record.ownerEmail),
    "record->>blocked_reason": postgrestScalarGuard(record.blocked_reason),
    "record->>contact_hold_reason": postgrestScalarGuard(record.contact_hold_reason),
    "record->>suppression_reason": postgrestScalarGuard(record.suppression_reason),
    "record->>do_not_contact": postgrestScalarGuard(record.do_not_contact),
    "record->>suppressed": postgrestScalarGuard(record.suppressed),
    "record->>contact_suppressed": postgrestScalarGuard(record.contact_suppressed),
    "record->>email_suppressed": postgrestScalarGuard(record.email_suppressed),
    "record->preview_build_consent->>status": postgrestScalarGuard(consent.status),
    "record->preview_build_consent->>recorded_at": postgrestScalarGuard(consent.recorded_at),
    "record->preview_build_consent->>source": postgrestScalarGuard(consent.source),
    "record->contact_enrichment->outreach->>review_hold": postgrestScalarGuard(outreach.review_hold),
    "record->contact_enrichment->outreach->>status": postgrestScalarGuard(outreach.status),
    "record->contact_enrichment->>email_invalid": postgrestScalarGuard(enrichment.email_invalid),
    "record->contact_enrichment->>email_suppressed": postgrestScalarGuard(enrichment.email_suppressed),
    "record->contact_enrichment->>do_not_contact": postgrestScalarGuard(enrichment.do_not_contact),
  };
}

function reconciliationPersistenceProven(result, expected = {}) {
  if (result?.mode !== "live_update" || result.updated !== true) return false;
  const rows = Array.isArray(result.rows) ? result.rows : [];
  if (rows.length !== 1) return false;
  const row = rows[0];
  const record = isObject(row.record) ? row.record : {};
  const dispatch = isObject(record.build_dispatch) ? record.build_dispatch : {};
  return row.prospect_id === expected.id
    && row.status === "held"
    && record.prospect_id === expected.id
    && record.status === "held"
    && sameInstant(row.updated_at, expected.updatedAt)
    && dispatch.disposition === "system_hold"
    && dispatch.lead_rejection === false
    && dispatch.provider_attempted === true
    && dispatch.manual_reconciliation_required === true
    && dispatch.redeploy_allowed === false
    && dispatch.system_hold?.scope === "mirror_reconciliation"
    && exactMirrorReconciliationEvidence({
      prospectId: expected.id,
      reconciliation: dispatch.reconciliation,
      releaseEvidence: dispatch.release_evidence,
    })
    && canonicalJson(dispatch.reconciliation || null) === canonicalJson(expected.reconciliation || null)
    && canonicalJson(dispatch.release_evidence || null) === canonicalJson(expected.releaseEvidence || null);
}

function activeMirrorBuildClaim(prospect = {}, nowMs = Date.now()) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const claim = isObject(record[MIRROR_REVEAL_CLAIM_KEY]) ? record[MIRROR_REVEAL_CLAIM_KEY] : null;
  const expiresAt = Date.parse(String(claim?.lease_expires_at || ""));
  if (!claim
    || claim.schema !== "wss.mirror.build_claim.v1"
    || claim.state !== "in_flight"
    || !String(claim.claim_id || "").trim()
    || !String(claim.operation_key || "").trim()
    || !/^[a-f0-9]{64}$/.test(String(claim.source_fingerprint || ""))
    || !Number.isFinite(expiresAt)
    || expiresAt <= Number(nowMs)) {
    return null;
  }
  return { ...claim, expires_at_ms: expiresAt };
}

function mirrorBuildClaimProven(result, expected = {}) {
  if (result?.mode !== "live_update" || result.updated !== true || !Array.isArray(result.rows) || result.rows.length !== 1) {
    return null;
  }
  const row = result.rows[0];
  const record = isObject(row?.record) ? row.record : {};
  const claim = isObject(record[MIRROR_REVEAL_CLAIM_KEY]) ? record[MIRROR_REVEAL_CLAIM_KEY] : {};
  if (row?.prospect_id !== expected.id
    || !sameInstant(row.updated_at, expected.updatedAt)
    || row.status !== expected.status
    || claim.schema !== "wss.mirror.build_claim.v1"
    || claim.state !== "in_flight"
    || claim.claim_id !== expected.claimId
    || claim.operation_key !== expected.operationKey
    || claim.source_fingerprint !== expected.sourceFingerprint
    || claim.claimed_at !== expected.updatedAt
    || claim.lease_expires_at !== expected.leaseExpiresAt) {
    return null;
  }
  return row;
}

function directFinalPersistenceProven(result, expected = {}) {
  if (result?.mode !== "live_update" || result.updated !== true || !Array.isArray(result.rows) || result.rows.length !== 1) {
    return false;
  }
  const row = result.rows[0];
  return row?.prospect_id === expected.id
    && row.status === expected.patch.status
    && sameInstant(row.updated_at, expected.patch.updated_at)
    && (row.report_url || null) === (expected.patch.report_url || null)
    && (row.preview_url || null) === (expected.patch.preview_url || null)
    && canonicalJson(row.record || null) === canonicalJson(expected.patch.record || null);
}

function ownerFinalPersistenceProven(row, expected = {}) {
  const record = isObject(row?.record) ? row.record : {};
  const dispatch = isObject(record.build_dispatch) ? record.build_dispatch : {};
  return row?.prospect_id === expected.id
    && sameInstant(row?.updated_at, expected.updatedAt)
    && row?.status === expected.status
    && (row?.report_url || null) === (expected.reportUrl || null)
    && (row?.preview_url || null) === (expected.previewUrl || null)
    && record.prospect_id === expected.id
    && record.status === expected.status
    && (record.report_url || null) === (expected.reportUrl || null)
    && (record.preview_url || null) === (expected.previewUrl || null)
    && record.siteforge_qc_passed === expected.ready
    && record.siteforge_visual_qc_passed === expected.visualQcPassed
    && (record.siteforge_qc_contract || null) === (expected.qcContract || null)
    && (record.siteforge_renderer || null) === (expected.renderer || null)
    && (record.siteforge_generation_fingerprint || null) === (expected.generationFingerprint || null)
    && (dispatch.job_id || null) === (expected.jobId || null)
    && (dispatch.generation_fingerprint || null) === (expected.generationFingerprint || null)
    && dispatch.ready === expected.dispatchReady
    && dispatch.pending === expected.dispatchPending
    && dispatch.qc_passed === expected.ready
    && dispatch.visual_qc_passed === expected.visualQcPassed
    && (dispatch.renderer || null) === (expected.renderer || null)
    && (dispatch.qc_contract || null) === (expected.qcContract || null)
    && (dispatch.report_url || null) === (expected.reportUrl || null)
    && (dispatch.preview_url || null) === (expected.previewUrl || null)
    && canonicalJson(dispatch.release_evidence || null) === canonicalJson(expected.releaseEvidence || null)
    && !Object.hasOwn(record, AUTOSEND_KEY);
}

function ownerFinalRecordRebased(currentRecord = {}, finalRecord = {}) {
  const rebased = { ...currentRecord };
  for (const key of [
    "prospect_id",
    "status",
    "report_url",
    "preview_url",
    "preview_expires_at",
    "checkout_url",
    "truth_packet",
    "authority_summary",
    "optimization_manifest_url",
    "truth_packet_source",
    "build_dispatch",
    "siteforge_qc_passed",
    "siteforge_visual_qc_passed",
    "siteforge_qc_contract",
    "siteforge_renderer",
    "siteforge_generation_fingerprint",
    "release_evidence",
    "siteforge_callback",
    "blocked_reason",
    "packets",
  ]) {
    rebased[key] = finalRecord[key];
  }
  rebased.siteforge_callback = {
    ...(isObject(currentRecord.siteforge_callback) ? currentRecord.siteforge_callback : {}),
    ...(isObject(finalRecord.siteforge_callback) ? finalRecord.siteforge_callback : {}),
  };
  delete rebased[AUTOSEND_KEY];
  return rebased;
}

function ownerFinalRebaseSafe(currentRow, claimedRow, expected = {}) {
  const currentRecord = isObject(currentRow?.record) ? currentRow.record : {};
  const claimedRecord = isObject(claimedRow?.record) ? claimedRow.record : {};
  if (currentRow?.prospect_id !== expected.id
    || currentRecord[AUTOSEND_KEY]?.status !== "owner_proof_claimed"
    || currentRecord[AUTOSEND_KEY]?.claim_id !== expected.claimId
    || !Number.isFinite(Date.parse(String(currentRow.updated_at || "")))) {
    return false;
  }

  // A callback may advance only the build lifecycle while the owner proof is
  // running. Never rebase across a contact lifecycle change (unsubscribe,
  // do-not-contact, closed-lost, or any explicit suppression flag).
  const allowedStatuses = new Set([
    String(claimedRow?.status || "").trim().toLowerCase(),
    String(claimedRecord.status || "").trim().toLowerCase(),
    String(expected.status || "").trim().toLowerCase(),
  ].filter(Boolean));
  const currentStatuses = [
    String(currentRow.status || "").trim().toLowerCase(),
    String(currentRecord.status || "").trim().toLowerCase(),
  ].filter(Boolean);
  if (currentStatuses.some((status) => !allowedStatuses.has(status))) return false;

  for (const source of [currentRow, currentRecord]) {
    if ([
      "suppressed",
      "unsubscribed",
      "do_not_contact",
      "opted_out",
      "contact_suppressed",
      "email_suppressed",
    ].some((key) => source?.[key] === true)) {
      return false;
    }
  }
  return true;
}

function ownerFinalBuildReacquireSafe(currentRow, expected = {}) {
  const currentRecord = isObject(currentRow?.record) ? currentRow.record : {};
  const dispatch = isObject(currentRecord.build_dispatch) ? currentRecord.build_dispatch : {};
  if (currentRow?.prospect_id !== expected.id
    || Object.hasOwn(currentRecord, AUTOSEND_KEY)
    || !Number.isFinite(Date.parse(String(currentRow.updated_at || "")))
    || expected.ready !== true
    || expected.dispatchReady !== true
    || expected.dispatchPending !== false
    || expected.visualQcPassed !== true
    // Identity is a COHERENT PAIR from an accepted renderer, and the release
    // evidence schema must belong to that renderer. Mirror Engine calls this
    // field evidence_schema; the two legacy producers call it schema. Preserve
    // each renderer's signed native envelope and fail cross-stamping closed.
    || !acceptedRendererPair(expected.renderer, expected.qcContract)
    || !expected.jobId
    || !expected.generationFingerprint
    || !isObject(expected.releaseEvidence)
    || (expected.releaseEvidence.evidence_schema || expected.releaseEvidence.schema) !== (
      expected.renderer === FORGE_MIRROR_RENDERER
        ? "ghost-forge-release-evidence-v1"
        : expected.renderer === MIRROR_ENGINE_RENDERER
          ? MIRROR_ENGINE_EVIDENCE_SCHEMA
          : "siteforge-release-evidence-v1"
    )
    || currentRecord.prospect_id !== expected.id
    || currentRow.status !== expected.status
    || currentRecord.status !== expected.status
    || (currentRow.report_url || null) !== (expected.reportUrl || null)
    || (currentRow.preview_url || null) !== (expected.previewUrl || null)
    || (currentRecord.report_url || null) !== (expected.reportUrl || null)
    || (currentRecord.preview_url || null) !== (expected.previewUrl || null)
    || currentRecord.siteforge_qc_passed !== true
    || currentRecord.siteforge_visual_qc_passed !== true
    // The persisted record must carry EXACTLY the identity the dispatch
    // asserted — not "any accepted identity", which would let a record drift
    // between renderers unnoticed.
    || currentRecord.siteforge_renderer !== expected.renderer
    || currentRecord.siteforge_qc_contract !== expected.qcContract
    || currentRecord.siteforge_generation_fingerprint !== expected.generationFingerprint
    || dispatch.ready !== true
    || dispatch.pending !== false
    || dispatch.job_id !== expected.jobId
    || (dispatch.report_url || null) !== (expected.reportUrl || null)
    || (dispatch.preview_url || null) !== (expected.previewUrl || null)
    || dispatch.generation_fingerprint !== expected.generationFingerprint
    || dispatch.renderer !== expected.renderer
    || dispatch.qc_passed !== true
    || dispatch.visual_qc_passed !== true
    || dispatch.qc_contract !== expected.qcContract
    || !isObject(dispatch.release_evidence)
    || (dispatch.release_evidence.evidence_schema || dispatch.release_evidence.schema)
      !== (expected.releaseEvidence.evidence_schema || expected.releaseEvidence.schema)) {
    return false;
  }

  for (const source of [currentRow, currentRecord]) {
    if ([
      "suppressed",
      "unsubscribed",
      "do_not_contact",
      "opted_out",
      "contact_suppressed",
      "email_suppressed",
    ].some((key) => source?.[key] === true)) {
      return false;
    }
  }
  return true;
}

function finiteDeadline(value) {
  const deadline = Number(value);
  return Number.isFinite(deadline) && deadline > 0 ? deadline : 0;
}

function deadlineExpired(deadlineAt, now = Date.now) {
  const deadline = finiteDeadline(deadlineAt);
  if (!deadline) return false;
  const nowMs = Number(typeof now === "function" ? now() : now);
  return deadline - (Number.isFinite(nowMs) ? nowMs : Date.now()) <= 0;
}

async function runBeforeDeadline(work, deadlineAt, now = Date.now) {
  const deadline = finiteDeadline(deadlineAt);
  if (!deadline) return { expired: false, value: await work(undefined) };
  const nowMs = Number(typeof now === "function" ? now() : now);
  const remainingMs = deadline - (Number.isFinite(nowMs) ? nowMs : Date.now());
  if (remainingMs <= 0) return { expired: true };
  const controller = new AbortController();
  let timer;
  const expiredToken = {};
  try {
    const value = await Promise.race([
      Promise.resolve()
        .then(() => work(controller.signal))
        .catch((error) => {
          if (controller.signal.aborted) return expiredToken;
          throw error;
        }),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort(new Error("owner_proof_deadline_exhausted"));
          resolve(expiredToken);
        }, Math.max(1, Math.floor(remainingMs)));
      }),
    ]);
    return value === expiredToken ? { expired: true } : { expired: false, value };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function boundedOwnerProofWork(work, deadlineAt, maxMs = OWNER_PROOF_AUDIT_TIMEOUT_MAX_MS) {
  const remainingMs = Number(deadlineAt) - Date.now();
  if (!Number.isFinite(remainingMs) || remainingMs <= OWNER_PROOF_SEND_START_MIN_MS) {
    return { skipped: "owner_proof_deadline_exhausted" };
  }
  const timeoutMs = Math.max(1, Math.min(
    maxMs,
    remainingMs - OWNER_PROOF_SEND_START_MIN_MS,
  ));
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(work).catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ skipped: "owner_proof_audit_timeout" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function clampNumber(value, fallback, min, max) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function fullRunId() {
  return `fullrun_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
}

function requestedRunId(value) {
  const candidate = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{1,120}$/.test(candidate) ? candidate : fullRunId();
}

function cleanCategory(value) {
  return approvedIndustry(String(value || "").trim());
}

function approvedIndustryFrom(values = []) {
  for (const value of values.flat(Infinity)) {
    const approved = cleanCategory(isObject(value) ? value.value : value);
    if (approved) return approved;
  }
  return "";
}

function truthPacketIndustry(truthPacket = {}, expectedWebsite = "") {
  if (!isObject(truthPacket)) return "";
  const identityCategory = truthPacket.identity?.category;
  const confidentIdentityCategory = isObject(identityCategory)
    ? (identityCategory.verified === true || String(identityCategory.status || "").toLowerCase() === "verified" || Number(identityCategory.confidence) >= 0.7)
      ? identityCategory.value
      : ""
    : identityCategory;
  const categoryEvidence = serviceEvidence(truthPacket)
    .filter((row) => isVerifiedCategoryEvidence(row, expectedWebsite))
    .map((row) => row.value);
  const category = approvedIndustryFrom([
    confidentIdentityCategory,
    categoryEvidence,
  ]);
  if (category) return category;

  const verifiedServices = serviceEvidence(truthPacket)
    .filter((row) => isVerifiedServiceEvidence(row, expectedWebsite))
    .map((row) => row.value);
  return approvedIndustryFrom([verifiedServices]);
}

function cleanLocation(value) {
  return String(value || "").trim();
}

function emailOf(prospect = {}) {
  return firstValue(prospect, ["email", "owner_email", "ownerEmail"]).toLowerCase();
}

function emailHash(value = "") {
  const email = String(value || "").trim().toLowerCase();
  return email ? createHash("sha256").update(email).digest("hex") : "";
}

function hasBuildUrls(prospect = {}) {
  return Boolean(firstValue(prospect, ["report_url", "reportUrl"]) && firstValue(prospect, ["preview_url", "previewUrl"]));
}

function safeDispatchCode(value) {
  const code = String(value || "").trim();
  if (!code) return undefined;
  return code.replace(/[^a-zA-Z0-9_.:-]+/g, "_").slice(0, 120);
}

function consentFirstQueueGate(item = {}) {
  if (!item.ok || !emailOf(item.prospect)) return { ok: false };
  return {
    ok: true,
    prospect: consentFirstSendProspect(item.prospect),
  };
}

function sanitizedSkipReasons(skipped = []) {
  return skipped.map((item) => ({
    prospect_id: safeDispatchCode(item?.prospect_id) || null,
    reason: safeDispatchCode(item?.skipped) || "send_failed",
  }));
}

function safeDispatchError(value) {
  const message = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!message) return undefined;
  return message
    .replace(/\b(Bearer)\s+\S+/gi, "$1 [redacted]")
    .replace(/\b(token|api[_-]?key|authorization|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/([?&](?:token|api[_-]?key|authorization|secret|password)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 240);
}

function safeHttpStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function dispatchSummary(dispatch = {}) {
  const result = dispatch.result || {};
  const urls = dispatch.urls || {};
  const status = dispatch.buildStatus || {};
  const resultBody = result.json && typeof result.json === "object" && !Array.isArray(result.json)
    ? result.json
    : {};
  const errorCode = safeDispatchCode(
    status.siteforge_code
      || dispatch.error_code
      || resultBody.error_code
      || resultBody.code,
  );
  const error = safeDispatchError(status.siteforge_error || dispatch.error || resultBody.error || resultBody.message);
  const httpStatus = safeHttpStatus(status.siteforge_http_status ?? dispatch.http_status ?? result.status);
  const isSystemHold = dispatch.disposition === "system_hold"
    && dispatch.retryable === true
    && dispatch.lead_rejection === false;
  const rawSystemHold = isObject(dispatch.system_hold) ? dispatch.system_hold : {};
  const reconciliation = isObject(dispatch.reconciliation)
    ? dispatch.reconciliation
    : isObject(rawSystemHold.reconciliation)
      ? rawSystemHold.reconciliation
      : null;
  const providerAttempted = isSystemHold && dispatch.provider_attempted === true;
  const manualReconciliationRequired = isSystemHold && (
    dispatch.manual_reconciliation_required === true
    || rawSystemHold.manual_reconciliation_required === true
  );
  const systemHold = isSystemHold ? {
    schema: safeDispatchCode(rawSystemHold.schema) || "wss.mirror.system_hold.v1",
    type: "system",
    code: safeDispatchCode(rawSystemHold.code || dispatch.reason) || "mirror_system_hold",
    retryable: true,
    scope: safeDispatchCode(rawSystemHold.scope) || "mirror_build",
    ...(manualReconciliationRequired ? { manual_reconciliation_required: true } : {}),
    ...(manualReconciliationRequired ? { rebuild_allowed: false, redeploy_allowed: false } : {}),
    ...(reconciliation ? { reconciliation } : {}),
  } : undefined;
  return {
    mode: dispatch.mode || "unknown",
    configured: dispatch.configured === undefined
      ? String(dispatch.mode || "").startsWith("mirror")
      : Boolean(dispatch.configured),
    ok: dispatch.ok ?? result.ok,
    status: result.status,
    report_url: urls.report_url || null,
    preview_url: urls.preview_url || null,
    optimization_manifest_url: dispatch.optimizationManifestUrl || null,
    authority_summary: dispatch.authoritySummary || null,
    ready: Boolean(status.ready),
    renderer: status.renderer || null,
    required_renderer: status.required_renderer || REQUIRED_RENDERER,
    generation_fingerprint: status.generation_fingerprint || null,
    qc_passed: Boolean(status.qc_passed),
    visual_qc_passed: Boolean(status.visual_qc_passed),
    qc_contract: status.qc_contract || null,
    required_qc_contract: status.required_qc_contract || REQUIRED_QC_CONTRACT,
    grade: status.grade || null,
    score: status.score ?? null,
    pending: Boolean(dispatch.pending || status.pending),
    retryable: isSystemHold ? true : undefined,
    disposition: isSystemHold ? "system_hold" : undefined,
    lead_rejection: isSystemHold ? false : undefined,
    provider_attempted: isSystemHold ? providerAttempted : undefined,
    manual_reconciliation_required: isSystemHold ? manualReconciliationRequired : undefined,
    rebuild_allowed: manualReconciliationRequired ? false : undefined,
    redeploy_allowed: manualReconciliationRequired ? false : undefined,
    source_fingerprint: /^[a-f0-9]{64}$/.test(String(dispatch.source_fingerprint || ""))
      ? dispatch.source_fingerprint
      : undefined,
    reconciliation: isSystemHold ? reconciliation || undefined : undefined,
    system_hold: systemHold,
    job_id: dispatch.jobId || null,
    status_url: dispatch.statusUrl || null,
    blocked: status.blocked ?? dispatch.blocked ?? undefined,
    reason: dispatch.reason || undefined,
    error_code: errorCode,
    error,
    http_status: httpStatus,
    release_evidence: dispatch.releaseEvidence || dispatch.release_evidence || status.release_evidence || null,
  };
}

function buildBlockReason(dispatch = {}) {
  if (dispatch.blocked) {
    return Array.isArray(dispatch.blocked) ? dispatch.blocked.join(",") : String(dispatch.blocked);
  }
  if (dispatch.configured === false) return dispatch.reason || "siteforge_not_configured";
  if (dispatch.error) return dispatch.error;
  const status = dispatch.buildStatus || {};
  if (Array.isArray(status.blocked) && status.blocked.length) return status.blocked.join(",");
  if (dispatch.result && dispatch.result.ok === false) return `siteforge_http_${dispatch.result.status || "failed"}`;
  if (status.required_renderer === MIRROR_ENGINE_RENDERER || status.renderer === MIRROR_ENGINE_RENDERER) {
    return "mirror_engine_qc_or_renderer_gate_not_passed";
  }
  return "siteforge_qc_or_renderer_gate_not_passed";
}

/**
 * Return the minimum immutable handle needed to READ one pre-existing legacy
 * SiteForge job, or null. This is deliberately stricter than "resume exists":
 * the state must come from the freshly loaded row, identify the same prospect,
 * still be pending in both column/record state, and bind its job id to the
 * canonical SiteForge status URL. No request-body dispatch can manufacture
 * this authorization and no completed legacy build can pass it.
 */
function legacySiteForgePendingResume(durableProspect = {}, expectedId = "") {
  if (!isObject(durableProspect)) return null;
  const record = isObject(durableProspect.record) ? durableProspect.record : null;
  const dispatch = record && isObject(record.build_dispatch) ? record.build_dispatch : null;
  const id = String(expectedId || "").trim();
  if (!record || !dispatch || !id) return null;
  if (String(durableProspect.prospect_id || "").trim() !== id) return null;
  if (String(record.prospect_id || "").trim() !== id) return null;
  if (String(durableProspect.status || "").trim() !== "new") return null;
  if (record.status != null && String(record.status).trim() !== "new") return null;
  if (String(record.blocked_reason || "").trim() !== "siteforge_build_pending") return null;
  if (dispatch.pending !== true || dispatch.ready === true) return null;
  if (!["http_dispatch", "existing_job_status_read"].includes(String(dispatch.mode || "").trim())) return null;

  const jobId = String(dispatch.job_id || "").trim();
  const rawStatusUrl = String(dispatch.status_url || "").trim();
  if (!jobId || !/^[A-Za-z0-9._:-]+$/.test(jobId) || !rawStatusUrl) return null;
  try {
    const buildUrl = new URL(CANONICAL_SITEFORGE_BUILD_URL);
    const statusUrl = new URL(rawStatusUrl);
    const prefix = `${buildUrl.pathname.replace(/\/+$/, "")}/`;
    const urlJobId = decodeURIComponent(statusUrl.pathname.slice(prefix.length));
    if (statusUrl.protocol !== "https:"
      || statusUrl.origin !== buildUrl.origin
      || !statusUrl.pathname.startsWith(prefix)
      || urlJobId !== jobId
      || statusUrl.username
      || statusUrl.password
      || statusUrl.search
      || statusUrl.hash) {
      return null;
    }
    return Object.freeze({ job_id: jobId, status_url: statusUrl.toString() });
  } catch (_) {
    return null;
  }
}

function legacyBuildDispatchForHistory(record = {}) {
  if (isObject(record.legacy_build_dispatch)) return record.legacy_build_dispatch;
  const dispatch = isObject(record.build_dispatch) ? record.build_dispatch : null;
  if (!dispatch) return null;
  const renderer = String(dispatch.renderer || "").trim();
  const mode = String(dispatch.mode || "").trim();
  return renderer !== MIRROR_ENGINE_RENDERER
    || ["http_dispatch", "existing_job_status_read", "forge_job_mirror"].includes(mode)
    ? dispatch
    : null;
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  if (isObject(value)) return Object.values(value).some(hasValue);
  return String(value ?? "").trim().length > 0;
}

function postgrestScalarGuard(value) {
  const normalized = value == null ? "" : String(value).trim();
  return normalized ? `eq.${normalized}` : "is.null";
}

function sourceAssets(packet = {}) {
  const canonical = isObject(packet.intakeGenie) ? packet.intakeGenie : {};
  return [canonical.assets, packet.assets, packet.source_assets, packet.media?.catalog]
    .filter(Array.isArray)
    .flat()
    .filter(isObject);
}

const CONSENT_CONTACT_TERMINAL_STATUSES = new Set([
  "opted_out", "unsubscribed", "do_not_contact", "suppressed",
  "contact_suppressed", "email_suppressed", "invalid_email", "email_invalid",
  "held", "blocked", "quarantined", "vertical_mismatch_sport_fencing",
  "closed_lost", "archived", "archived_legacy", "bounced", "complained",
]);
const PREVIEW_BUILD_TERMINAL_STATUSES = new Set([
  "opted_out", "unsubscribed", "do_not_contact", "suppressed",
  "contact_suppressed", "email_suppressed", "closed_lost", "archived",
  "archived_legacy", "bounced", "complained",
]);

function consentPolicyCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function consentPolicyFlag(value) {
  return value === true || /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function previewBuildTerminalReason(prospect = {}) {
  const record = isObject(prospect.record) ? prospect.record : {};
  const enrichment = isObject(record.contact_enrichment) ? record.contact_enrichment : {};
  const enrichmentOutreach = isObject(enrichment.outreach) ? enrichment.outreach : {};
  const recordOutreach = isObject(record.outreach) ? record.outreach : {};
  const status = [prospect.status, record.status]
    .map(consentPolicyCode)
    .find((value) => PREVIEW_BUILD_TERMINAL_STATUSES.has(value));
  if (status) return status;
  const reason = [
    prospect.blocked_reason,
    prospect.contact_hold_reason,
    prospect.suppression_reason,
    record.blocked_reason,
    record.contact_hold_reason,
    record.suppression_reason,
  ].map(consentPolicyCode).find((value) => PREVIEW_BUILD_TERMINAL_STATUSES.has(value));
  if (reason) return reason;
  for (const source of [prospect, record]) {
    for (const flag of ["do_not_contact", "suppressed", "contact_suppressed", "email_suppressed"]) {
      if (consentPolicyFlag(source[flag])) return flag;
    }
  }
  if (consentPolicyFlag(enrichment.do_not_contact)) return "do_not_contact";
  if (consentPolicyFlag(enrichment.email_suppressed)) return "email_suppressed";
  if (consentPolicyFlag(enrichment.email_invalid)) return "email_invalid";
  for (const outreach of [enrichmentOutreach, recordOutreach]) {
    const outreachStatus = consentPolicyCode(outreach.status);
    if (PREVIEW_BUILD_TERMINAL_STATUSES.has(outreachStatus)) return outreachStatus;
  }
  try {
    for (const source of [prospect, record]) {
      const gate = contactSendGate(source);
      if (!gate?.hasEnrichment || !gate.blocked) continue;
      const reasons = Array.isArray(gate.blockedReasons) && gate.blockedReasons.length
        ? gate.blockedReasons
        : Array.isArray(gate.holdReasons)
          ? gate.holdReasons
          : [];
      return consentPolicyCode(reasons[0]) || "contact_suppressed";
    }
  } catch (_) {
    return "contact_verdict_unavailable";
  }
  return "";
}

function canonicalConsentRecipient(prospect = {}) {
  if (!prospect || typeof prospect !== "object") {
    return { ok: false, reason: "canonical_recipient_unavailable" };
  }
  const record = isObject(prospect.record) ? prospect.record : {};
  const topStatus = consentPolicyCode(prospect.status);
  const statuses = [topStatus, consentPolicyCode(record.status)].filter(Boolean);
  const terminal = statuses.find((status) => CONSENT_CONTACT_TERMINAL_STATUSES.has(status));
  if (terminal) return { ok: false, reason: terminal };
  const terminalReason = [
    prospect.blocked_reason,
    prospect.contact_hold_reason,
    prospect.suppression_reason,
    record.blocked_reason,
    record.contact_hold_reason,
    record.suppression_reason,
  ].map(consentPolicyCode).find((reason) => CONSENT_CONTACT_TERMINAL_STATUSES.has(reason));
  if (terminalReason) return { ok: false, reason: terminalReason };
  for (const source of [prospect, record]) {
    if (consentPolicyFlag(source.do_not_contact)) return { ok: false, reason: "do_not_contact" };
    if (consentPolicyFlag(source.suppressed)) return { ok: false, reason: "suppressed" };
    if (consentPolicyFlag(source.contact_suppressed)) return { ok: false, reason: "contact_suppressed" };
    if (consentPolicyFlag(source.email_suppressed)) return { ok: false, reason: "email_suppressed" };
  }
  if (!topStatus) return { ok: false, reason: "canonical_status_unavailable" };

  const email = normalizeEmail(emailOf(prospect));
  if (!email || isPlaceholderEmail(email)) return { ok: false, reason: "invalid_email" };
  let gates;
  try {
    gates = [contactSendGate(prospect), contactSendGate(record)]
      .filter((gate) => gate && gate.hasEnrichment);
  } catch {
    return { ok: false, reason: "contact_verdict_unavailable" };
  }
  for (const gate of gates) {
    const holdReasons = (Array.isArray(gate.blockedReasons) && gate.blockedReasons.length
      ? gate.blockedReasons
      : (Array.isArray(gate.holdReasons) ? gate.holdReasons : []))
      .map(consentPolicyCode);
    if (gate.blocked) {
      return { ok: false, reason: holdReasons[0] || "contact_suppressed" };
    }
    const sendable = normalizeEmail(gate.sendableEmail || "");
    if (sendable && sendable !== email) return { ok: false, reason: "canonical_recipient_changed" };
  }
  return { ok: true, email, fingerprint: emailHash(email) };
}

function canonicalContactGuards(prospect = {}, expectedEmail = "") {
  const expected = normalizeEmail(expectedEmail);
  if (!expected) return null;
  const recipientMatches = ["email", "owner_email"].some((column) => {
    const raw = String(prospect[column] || "").trim();
    return raw && normalizeEmail(raw) === expected;
  });
  if (!recipientMatches) return null;

  const record = isObject(prospect.record) ? prospect.record : {};
  const enrichment = isObject(record.contact_enrichment) ? record.contact_enrichment : {};
  const outreach = isObject(enrichment.outreach) ? enrichment.outreach : {};
  const recordOutreach = isObject(record.outreach) ? record.outreach : {};
  return {
    // Guard both generated recipient columns, including their null state. This
    // accepts owner_email-only legacy rows and preserves their exact casing,
    // while still detecting a concurrent recipient change in either column.
    email: postgrestScalarGuard(prospect.email),
    owner_email: postgrestScalarGuard(prospect.owner_email),
    // Never put the whole JSON record into a PostgREST URL. Guard only the
    // compact contact-law scalars that a STOP/hold/enrichment writer may set.
    "record->>status": postgrestScalarGuard(record.status),
    "record->>email": postgrestScalarGuard(record.email),
    "record->>owner_email": postgrestScalarGuard(record.owner_email),
    "record->>ownerEmail": postgrestScalarGuard(record.ownerEmail),
    "record->>blocked_reason": postgrestScalarGuard(record.blocked_reason),
    "record->>contact_hold_reason": postgrestScalarGuard(record.contact_hold_reason),
    "record->>suppression_reason": postgrestScalarGuard(record.suppression_reason),
    "record->>do_not_contact": postgrestScalarGuard(record.do_not_contact),
    "record->>suppressed": postgrestScalarGuard(record.suppressed),
    "record->>contact_suppressed": postgrestScalarGuard(record.contact_suppressed),
    "record->>email_suppressed": postgrestScalarGuard(record.email_suppressed),
    "record->>outreach_review_hold": postgrestScalarGuard(record.outreach_review_hold),
    "record->contact_enrichment->outreach->>review_hold": postgrestScalarGuard(outreach.review_hold),
    "record->contact_enrichment->outreach->>status": postgrestScalarGuard(outreach.status),
    "record->contact_enrichment->>email_invalid": postgrestScalarGuard(enrichment.email_invalid),
    "record->contact_enrichment->>email_suppressed": postgrestScalarGuard(enrichment.email_suppressed),
    "record->contact_enrichment->>do_not_contact": postgrestScalarGuard(enrichment.do_not_contact),
    "record->outreach->>review_hold": postgrestScalarGuard(recordOutreach.review_hold),
    "record->outreach->>status": postgrestScalarGuard(recordOutreach.status),
  };
}

function consentPacketHold(prospect, reason) {
  return {
    ok: false,
    prospect_id: prospectId(prospect),
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
    status: "held",
    blocked: reason,
    prospect,
    siteforge_dispatched: false,
    autosend_created: false,
    provider_calls: 0,
    policyHold: true,
    providerAttempted: false,
  };
}

function canonicalAssetCandidate(packet = {}, kindPattern) {
  return sourceAssets(packet).find((asset) => {
    const kind = String(asset.kind || asset.type || "").trim().toLowerCase();
    const url = String(asset.url || asset.src || "").trim();
    if (!kindPattern.test(kind) || !/^https:\/\//i.test(url)) return false;
    const provenance = [asset.source, asset.origin, asset.provenance, asset.source_type]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
      .join(" ");
    return /website|site|firecrawl|pagehub|upload|operator|owner/.test(provenance)
      && !/stock|generated|fallback|placeholder|\bai\b/.test(provenance);
  }) || null;
}

function canonicalVerifiedServices(packet = {}, expectedWebsite = "") {
  const canonical = isObject(packet.intakeGenie) ? packet.intakeGenie : {};
  const facts = isObject(canonical.facts) ? canonical.facts : {};
  const content = isObject(canonical.content) ? canonical.content : {};
  const offered = [
    canonical.services,
    facts.services,
    content.services,
    packet.services,
  ].filter(Array.isArray).flat();
  const evidence = serviceEvidence(packet)
    .filter((row) => isVerifiedServiceEvidence(row, expectedWebsite));
  if (!evidence.length) return [];

  const proven = new Set();
  for (const row of evidence) {
    const values = Array.isArray(row.value) ? row.value : [row.value];
    for (const value of values) {
      const name = String(isObject(value) ? (value.name || value.title || value.label || "") : value || "").trim();
      if (name) proven.add(name.toLowerCase());
    }
  }
  const seen = new Set();
  return offered.flatMap((value) => {
    const name = String(isObject(value) ? (value.name || value.title || value.label || "") : value || "").trim();
    const key = name.toLowerCase();
    if (!name || !proven.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ name }];
  }).slice(0, 24);
}

function isVerifiedSourceAsset(asset = {}, kinds = []) {
  const kind = String(asset.kind || asset.type || "").trim().toLowerCase();
  const url = String(asset.url || asset.src || "").trim();
  const provenance = [asset.source, asset.origin, asset.provenance]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const verified = asset.approved === true || asset.verified === true || String(asset.status || "").toLowerCase() === "verified";
  const sourceBacked = /source|site|website|firecrawl|pagehub|upload|operator|owner|drive|gbp|social/.test(provenance);
  const synthetic = /places[_ -]?basic|stock|ambiance|generated|fallback|placeholder|\bai\b/.test(provenance);
  return kinds.includes(kind) && /^https?:\/\//i.test(url) && verified && sourceBacked && !synthetic;
}

function serviceEvidence(packet = {}) {
  const canonical = isObject(packet.intakeGenie) ? packet.intakeGenie : {};
  return [canonical.evidence, canonical.service_evidence, packet.evidence, packet.service_evidence, packet.localSearchPlan?.citations]
    .filter(Array.isArray)
    .flat()
    .filter(isObject);
}

function evidenceSourceUrls(row = {}) {
  const nested = isObject(row.source) ? row.source : {};
  return [
    row.source_url,
    nested.url,
    typeof row.source === "string" ? row.source : "",
    ...(Array.isArray(row.source_observations) ? row.source_observations : []),
  ].map((value) => String(value || "").trim()).filter((value) => /^https?:\/\//i.test(value));
}

function hasVerifiedSourceProvenance(row = {}, expectedWebsite = "") {
  const source = isObject(row.source)
    ? [row.source.type, row.source.url, row.source.name].filter(Boolean).join(" ")
    : row.source;
  const provenance = [row.source_type, row.source_url, source, row.origin, row.provenance]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
  const explicitlyVerified = row.verified === true || String(row.status || "").toLowerCase() === "verified";
  const confidence = Number(row.confidence);
  const sourceUrls = evidenceSourceUrls(row);
  const firstPartyObservation = sourceUrls.length > 0
    && (!expectedWebsite || sourceUrls.every((url) => evidenceUrlMatchesSource(url, expectedWebsite)));
  // A verified flag cannot make a foreign page first-party. Check every URL,
  // including shared-site tenant paths, before reusing URL-bearing evidence.
  if (sourceUrls.length > 0 && expectedWebsite && !firstPartyObservation) return false;
  // Confidence is a compiler opinion, not verification. Exact observations
  // are usable only when their page belongs to the independently known site.
  const verified = explicitlyVerified
    || (Number.isFinite(confidence) && confidence >= 0.7 && firstPartyObservation);
  const sourceBacked = /source|site|website|firecrawl|pagehub|upload|operator|owner|drive|gbp|social|https?:\/\//.test(provenance);
  const synthetic = /places[_ -]?basic|stock|generated|fallback|placeholder|\bai\b/.test(provenance);
  return verified && sourceBacked && !synthetic;
}

function isVerifiedCategoryEvidence(row = {}, expectedWebsite = "") {
  const field = String(row.field || row.type || "").trim().toLowerCase();
  return /category|industry|vertical/.test(field) && hasValue(row.value)
    && hasVerifiedSourceProvenance(row, expectedWebsite);
}

function isVerifiedServiceEvidence(row = {}, expectedWebsite = "") {
  const fieldParts = String(row.field || row.type || "")
    .trim()
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (!fieldParts.some((part) => part === "service" || part === "services") || !hasValue(row.value)) return false;

  return hasVerifiedSourceProvenance(row, expectedWebsite);
}

function isReusableTruthPacket(packet, packetSource = "", expectedWebsite = "") {
  if (!isObject(packet)) return false;
  const canonical = isObject(packet.intakeGenie) ? packet.intakeGenie : {};
  const sources = [packetSource, packet.meta?.source, packet.source, canonical.source]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (!sources.length || sources.some((value) => /places[_ -]?basic/.test(value))) return false;

  const assets = sourceAssets(packet);
  return assets.some((asset) => isVerifiedSourceAsset(asset, ["logo"])) &&
    assets.some((asset) => isVerifiedSourceAsset(asset, ["photo", "video"])) &&
    serviceEvidence(packet).some((row) => isVerifiedServiceEvidence(row, expectedWebsite));
}

function isLeadMinerMirrorReadyPacket(packet, packetSource = "") {
  if (!isObject(packet)) return false;
  const canonical = isObject(packet.intakeGenie) ? packet.intakeGenie : {};
  return [packetSource, packet.meta?.source, packet.source, canonical.source]
    .some((value) => String(value || "").trim().toLowerCase() === "leadminer_mirror_ready");
}

function isCompleteLeadMinerMirrorReadyPacket(packet, packetSource = "", expectedWebsite = "") {
  return isLeadMinerMirrorReadyPacket(packet, packetSource)
    && packet.meta?.build_ready === true
    && Array.isArray(packet.meta?.missing_build_evidence)
    && packet.meta.missing_build_evidence.length === 0
    && Boolean(truthPacketIndustry(packet, expectedWebsite))
    && isReusableTruthPacket(packet, packetSource, expectedWebsite);
}

async function progress(runId, stage, payload = {}) {
  await event({
    type: "system.run",
    actor: payload.actor || "agent_00_orchestrator",
    status: payload.status || "ok",
    payload: {
      runId,
      stage,
      ...payload,
    },
  }).catch(() => null);
}

function prospectBuildInput(prospect = {}, truthPacket = {}) {
  const expectedWebsite = firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]);
  const packetServices = canonicalVerifiedServices(truthPacket, expectedWebsite);
  const suppliedServices = prospect.primary_services || prospect.services || [];
  const services = Array.isArray(suppliedServices) && suppliedServices.length
    ? suppliedServices
    : packetServices;
  const leadMinerPacket = isLeadMinerMirrorReadyPacket(truthPacket, prospect.truth_packet_source);
  const packetIndustry = truthPacketIndustry(truthPacket, expectedWebsite);
  const canonicalSource = String(
    truthPacket.meta?.source || truthPacket.source || truthPacket.intakeGenie?.source || "",
  ).trim().toLowerCase();
  const canonicalIntakeIndustry = canonicalSource === "intake_genie" && packetIndustry;
  // PRECEDENCE (the two laws, reconciled 2026-08-17): verified packet truth
  // beats a GENERIC or stale classification (the "Construction Contractor on
  // a landscaping site" fix) — but an APPROVED explicit top-level vertical on
  // the prospect is a stronger claim than the packet's fallback industry and
  // takes precedence. The intake branch used to bypass approved verticals
  // entirely, so an explicit "plumbing" was silently rebuilt as landscaping
  // whenever the packet carried any industry.
  const explicitApprovedIndustry = approvedIndustryFrom([
    prospect.industry,
    prospect.vertical,
    prospect.category,
    prospect.primary_type,
  ]);
  const industry = leadMinerPacket
    ? packetIndustry
    : (explicitApprovedIndustry || packetIndustry);
  // Carry the enriched JSONB record through so the mirror lane's packet can read
  // zip, county, geo, reviews, logo_url, brand_color, preview_url (2026-07-28).
  const record = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const packetAssets = sourceAssets(truthPacket);
  const packetLogo = canonicalAssetCandidate(truthPacket, /logo|brand[_ -]?mark/);
  const verifiedContent = isObject(prospect.verified_content)
    ? prospect.verified_content
    : (packetServices.length ? { services: packetServices } : null);
  return {
    id: prospectId(prospect),
    prospect_id: prospectId(prospect),
    record,
    zip: firstValue(prospect, ["zip", "postal", "postal_code"], "") || record.zip || "",
    county: firstValue(prospect, ["county"], "") || record.county || "",
    geo: firstValue(prospect, ["geo"], "") || record.geo || "",
    reviews: Array.isArray(prospect.reviews) ? prospect.reviews : (Array.isArray(record.reviews) ? record.reviews : []),
    // THE LOGO THE MINER ALREADY VERIFIED. This line used to read only the flat
    // logo_url/logo fields, which a build-ready mined row never carries — its
    // mark lives inside record.build_ready. So every dashboard build of a mined
    // lead reached the engine with no brand block and came back
    // "unbranded"/"wordmark-fallback", which can never be revealable. See
    // prospects.verifiedBrandOf for the two places the miner actually writes it;
    // that helper still falls back to the flat fields, so pre-contract rows are
    // read exactly as before.
    // Compiler logos are candidates only. The mirror lane still binds this URL
    // to the first-party site, rejects known third-party marks, fetches the
    // bytes through the SSRF guard and hashes what it actually renders. True
    // absence reaches the frozen logo ladder instead of killing the build.
    logo_url: verifiedBrandOf(prospect).logo || String(packetLogo?.url || packetLogo?.src || ""),
    // …and the accent the miner measured from that same mark, from the SAME
    // reader, so the dashboard and the line cannot drift apart on the colour the
    // way they once did on the logo. Only ever a fallback for a runtime that
    // cannot decode the bytes — see mirror-lane-build step 5.
    logo_accent: verifiedBrandOf(prospect).accent,
    logo_accent_source: verifiedBrandOf(prospect).accent_source,
    brand_color: firstValue(prospect, ["brand_color", "primary_color"], "") || record.brand_color || "",
    preview_url: firstValue(prospect, ["preview_url"], "") || record.preview_url || "",
    businessName: firstValue(prospect, ["business_name", "businessName", "name", "company"], "Local Business"),
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], "Local Business"),
    industry,
    city: firstValue(prospect, ["city", "market"], ""),
    state: firstValue(prospect, ["state", "region"], ""),
    ownerEmail: emailOf(prospect),
    email: emailOf(prospect),
    phone: firstValue(prospect, ["phone", "phoneNumber"]),
    address: firstValue(prospect, ["address", "formattedAddress"]),
    place_id: firstValue(prospect, ["place_id", "placeId"]),
    latlng: prospect.latlng || (Number.isFinite(Number(prospect.latitude)) && Number.isFinite(Number(prospect.longitude))
      ? { lat: Number(prospect.latitude), lng: Number(prospect.longitude) }
      : null),
    currentWebsite: firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
    current_website: firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
    services: Array.isArray(services) ? services : [],
    ...(verifiedContent ? { verified_content: verifiedContent } : {}),
    ...(packetAssets.length ? { genie_assets: packetAssets } : {}),
    source: firstValue(prospect, ["source"], "full-run"),
    truth_packet: truthPacket,
    truth_packet_source: truthPacket.meta?.source || prospect.truth_packet_source || "",
  };
}

async function truthPacketWithLocalPlan(prospect = {}, source = "full_run", options = {}) {
  const result = await callIntakeGenie(prospect, {
    pipelineVersion: source,
    buildPreview: false,
    dryRun: true,
    signal: options.signal,
  });
  if (!result.ok) {
    const error = new Error(boundedDetailText(result.error || "Intake Genie did not return a canonical packet."));
    error.code = "intake_genie_blocked";
    error.statusCode = 424;
    error.intakeGenie = result;
    throw error;
  }
  if (result.packet.status === "out_of_scope" || result.packet.scope?.supported === false) {
    const error = new Error(boundedDetailText(result.packet.scope?.message || "Prospect is outside Intake Genie scope."));
    error.code = "intake_genie_out_of_scope";
    error.statusCode = 422;
    error.intakeGenie = result;
    throw error;
  }
  if (result.packet.status === "needs_input" || result.packet.status === "blocked") {
    const error = new Error(boundedDetailText(result.packet.question || result.packet.error || "Intake Genie needs more facts before building."));
    error.code = "intake_genie_needs_input";
    error.statusCode = 422;
    error.intakeGenie = result;
    throw error;
  }
  return truthPacketFromCanonical(result.packet);
}

const CONSENT_EMAIL_ARTIFACT_KEYS = [
  "preview_url",
  "previewUrl",
  "checkout_url",
  "checkoutUrl",
  "stripe_url",
  "stripeUrl",
  "stripe_checkout_url",
  "stripeCheckoutUrl",
  "purchase_url",
  "purchaseUrl",
  "payment_url",
  "paymentUrl",
  "launch_url",
  "launchUrl",
  "report_url",
  "reportUrl",
  "callprep_report_url",
  "callprepReportUrl",
  "screenshot",
  "screenshots",
  "screenshot_url",
  "screenshotUrl",
  "preview_screenshot_url",
  "previewScreenshotUrl",
  "iframe",
  "iframe_html",
  "iframeHtml",
  "embed_html",
  "embedHtml",
  "mshots_url",
  "mshotsUrl",
  "preview_expires_at",
  "previewExpiresAt",
  "preview_expiry_date",
  "previewExpiryDate",
  "sunset_date",
  "sunsetDate",
  "build_dispatch",
  "siteforge_callback",
  "release_evidence",
  "forge_job",
  "truth_packet",
  "packets",
];

function stripPrebuiltArtifacts(source = {}) {
  const clean = isObject(source) ? { ...source } : {};
  for (const key of CONSENT_EMAIL_ARTIFACT_KEYS) delete clean[key];
  return clean;
}

function consentFirstSendProspect(prospect = {}) {
  const clean = stripPrebuiltArtifacts(prospect);
  return {
    ...clean,
    record: stripPrebuiltArtifacts(prospect.record),
    consent_first: true,
  };
}

async function packetProspectForConsent(prospect = {}, options = {}) {
  const id = prospectId(prospect);
  const source = options.source || "full_run_consent_first";
  const truthPacketFn = options.truthPacketWithLocalPlan || truthPacketWithLocalPlan;
  const selectFn = options.select || select;
  const conditionalUpdateFn = options.conditionalUpdate || conditionalUpdate;
  const upsertRowFn = options.upsertRow || upsertRow;
  const persist = options.persist !== false;
  const requireCanonicalGuard = options.requireCanonicalGuard === true;
  let truthPacket;
  let canonicalVerdict = null;

  // Read the current row before provider work. Besides protecting STOP/contact
  // state, this gives the nightly lane an exact CAS identity for a durable hold
  // when certification fails; a parked row is never re-scraped every cron.
  if (requireCanonicalGuard) {
    const loaded = await loadPersistedProspects([id], selectFn).catch(() => ({
      ok: false,
      blocked: "prospect_store_read_failed",
    }));
    if (!loaded.ok || !loaded.prospects?.[0]) {
      return consentPacketHold(prospect, loaded.blocked || "canonical_recipient_unavailable");
    }
    prospect = loaded.prospects[0];
    canonicalVerdict = canonicalConsentRecipient(prospect);
    if (!canonicalVerdict.ok) return consentPacketHold(prospect, canonicalVerdict.reason);
  }

  const suppliedTruthPacket = prospect.truth_packet;
  const suppliedLeadMinerPacket = isLeadMinerMirrorReadyPacket(
    suppliedTruthPacket,
    prospect.truth_packet_source,
  );
  if (suppliedLeadMinerPacket && !isCompleteLeadMinerMirrorReadyPacket(
    suppliedTruthPacket,
    prospect.truth_packet_source,
    firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
  )) {
    return {
      ok: false,
      prospect_id: id,
      status: "held",
      blocked: "leadminer_truth_packet_incomplete",
      message: "LeadMiner payload is incomplete; discovery fallback is disabled.",
      prospect,
      truth_packet: suppliedTruthPacket,
      siteforge_dispatched: false,
      autosend_created: false,
      provider_calls: 0,
    };
  }

  try {
    truthPacket = isReusableTruthPacket(
      prospect.truth_packet,
      prospect.truth_packet_source,
      firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
    )
      ? prospect.truth_packet
      : await truthPacketFn(prospect, source);
  } catch (error) {
    const blocked = error.code || "intake_genie_blocked";
    let persistence = "not_persisted";
    if (options.parkOnFailure === true && requireCanonicalGuard) {
      const version = String(prospect.updated_at || "").trim();
      const status = String(prospect.status || "").trim();
      const contactGuards = canonicalContactGuards(prospect, canonicalVerdict?.email);
      if (version && status && contactGuards) {
        const nowValue = Number(typeof options.now === "function" ? options.now() : Date.now());
        const prior = Date.parse(version);
        const attemptedMs = Number.isFinite(prior)
          ? Math.max(Number.isFinite(nowValue) ? nowValue : Date.now(), prior + 1)
          : (Number.isFinite(nowValue) ? nowValue : Date.now());
        const attemptedAt = new Date(attemptedMs).toISOString();
        const record = isObject(prospect.record) ? prospect.record : {};
        const hold = {
          schema: "wss.consent_packet_hold.v1",
          reason: String(blocked).slice(0, 160),
          source,
          attempted_at: attemptedAt,
        };
        const parked = await conditionalUpdateFn(
          "ghost_agency_prospects",
          "prospect_id",
          id,
          { updated_at: `eq.${version}`, status: `eq.${status}`, ...contactGuards },
          {
            status: "held",
            record: { ...record, status: "held", consent_packet_hold: hold },
            updated_at: attemptedAt,
          },
        ).catch(() => null);
        persistence = parked?.ok === true && parked.updated === true ? "parked" : "park_conflict";
      } else {
        persistence = "park_identity_missing";
      }
    }
    return {
      ok: false,
      prospect_id: id,
      status: "held",
      blocked,
      message: error.message || boundedDetailText(error),
      prospect,
      siteforge_dispatched: false,
      autosend_created: false,
      persistence,
    };
  }

  const packetProspect = prospectBuildInput(prospect, truthPacket);
  const job = buildCanonicalJob({
    prospect: packetProspect,
    jobId: options.jobId || `consent_packet_${id}_${Date.now()}`,
  });
  const record = isObject(prospect.record) ? prospect.record : {};
  const existingStatus = String(prospect.status || record.status || "").trim().toLowerCase();
  const nextStatus = !existingStatus || ["new", "reported"].includes(existingStatus)
    ? "packeted"
    : existingStatus;
  const priorIntent = isObject(prospect[AUTOSEND_KEY])
    ? prospect[AUTOSEND_KEY]
    : isObject(record[AUTOSEND_KEY])
      ? record[AUTOSEND_KEY]
      : null;
  const retiredIntent = abandonPendingAutosend(priorIntent);
  const consent = recordedPositivePreviewConsent(prospect);
  const mergedRecord = {
    // `record` here is the INNER record, already unwrapped — carrying it
    // forward is the legitimate merge. `prospect` comes from prospectFromRow
    // and still holds a `record` key, so spreading it raw nested the entire
    // prior blob one level deeper on every save.
    ...record,
    ...recordForPersist(prospect),
    ...recordForPersist(packetProspect),
    prospect_id: id,
    status: nextStatus,
    truth_packet: truthPacket,
    truth_packet_source: truthPacket.meta?.source || source,
    packets: job.packets,
    preview_build_consent_gate: consent.ok
      ? {
          status: "recorded_positive_consent",
          recorded_at: consent.recordedAt,
          source: consent.source,
          next_action: "explicit_post_reply_build",
        }
      : {
          status: "blocked_until_recorded_positive_consent",
          next_action: "wait_for_reply",
        },
  };
  if (retiredIntent) mergedRecord[AUTOSEND_KEY] = retiredIntent;

  let persistence = "not_persisted";
  if (persist) {
    // Stamp the write only after truth work and the fresh canonical read. A
    // timestamp captured at entry can move a row version backwards after a
    // concurrent STOP/contact update.
    const nowValue = Number(typeof options.now === "function" ? options.now() : Date.now());
    const priorUpdatedAt = requireCanonicalGuard ? Date.parse(prospect.updated_at || "") : NaN;
    const patchTime = Number.isFinite(priorUpdatedAt)
      ? Math.max(Number.isFinite(nowValue) ? nowValue : Date.now(), priorUpdatedAt + 1)
      : (Number.isFinite(nowValue) ? nowValue : Date.now());
    const updatedAt = new Date(patchTime).toISOString();
    const patch = {
      prospect_id: id,
      status: nextStatus,
      record: mergedRecord,
      updated_at: updatedAt,
    };
    let saved;
    if (requireCanonicalGuard) {
      const version = String(prospect.updated_at || "").trim();
      const status = String(prospect.status || "").trim();
      const contactGuards = canonicalContactGuards(prospect, canonicalVerdict?.email);
      if (!version || !status || !contactGuards) {
        return consentPacketHold(prospect, "consent_packet_persist_identity_missing");
      }
      try {
        saved = await conditionalUpdateFn(
          "ghost_agency_prospects",
          "prospect_id",
          id,
          {
            updated_at: `eq.${version}`,
            status: `eq.${status}`,
            ...contactGuards,
          },
          patch,
        );
      } catch {
        return consentPacketHold(prospect, "consent_packet_persist_unavailable");
      }
      if (!saved || saved.ok !== true || saved.updated !== true) {
        return consentPacketHold(prospect, "consent_packet_persist_conflict");
      }
    } else {
      saved = await upsertRowFn("ghost_agency_prospects", patch, "prospect_id");
    }
    persistence = saved?.mode || (saved?.ok === false ? "persist_failed" : "persisted");
  }

  return {
    ok: true,
    prospect_id: id,
    business_name: packetProspect.business_name,
    status: nextStatus,
    packeted: true,
    packets: job.packets,
    truth_packet: truthPacket,
    consent,
    prebuild: consent.ok
      ? "recorded_positive_consent_requires_explicit_post_reply_build"
      : "blocked_until_recorded_positive_consent",
    siteforge_dispatched: false,
    autosend_created: false,
    persistence,
    prospect: {
      ...prospect,
      ...packetProspect,
      record: mergedRecord,
      status: nextStatus,
      truth_packet: truthPacket,
      packets: job.packets,
    },
  };
}

async function buildPreviewForProspect(prospect = {}, options = {}) {
  const id = prospectId(prospect);
  const source = options.source || "full_run";
  const truthPacketFn = options.truthPacketWithLocalPlan || truthPacketWithLocalPlan;
  const conditionalUpdateFn = options.conditionalUpdate || conditionalUpdate;
  const selectFn = options.select || select;
  const nowFn = options.now || (() => Date.now());
  const deadlineNowFn = options.deadlineNow || (() => Date.now());
  const persist = options.persist !== false;
  const ownerBuildDeadlineAt = finiteDeadline(options.buildDeadlineAt || options.deadlineAt);
  const ownerRequestDeadlineAt = finiteDeadline(options.requestDeadlineAt || options.deadlineAt);
  const ownerBuildExpired = () => options.awaitTerminal === true
    && deadlineExpired(ownerBuildDeadlineAt, deadlineNowFn);
  const deadlineHold = (blocked = "owner_proof_build_deadline_exhausted") => ({
    ok: false,
    pending: false,
    prospect_id: id,
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
    status: "held",
    blocked,
    persistence: "deadline_not_started",
    prospect,
  });
  // Defense in depth: do not start Intake Genie, a claim, or any persistence
  // after the build window reserved by the route has already closed.
  if (ownerBuildExpired()) return deadlineHold();

  // Consent is a durable-state gate, not a request-body flag. Every production
  // caller (admin, reveal, Riley, reconciler, or a future route) must prove the
  // positive reply from a fresh prospect-store read before any truth work,
  // claim, persistence, mirror shortcut, or SiteForge dispatch can begin.
  // This deliberately ignores preview_build_consent supplied only in JSON.
  const durableLoad = await loadPersistedProspects([id], selectFn).catch(() => ({
    ok: false,
    blocked: "prospect_store_read_failed",
  }));
  const durableProspect = durableLoad.ok ? durableLoad.prospects[0] : null;
  const terminalBuildReason = durableLoad.ok
    ? previewBuildTerminalReason(durableProspect || {})
    : "";
  if (terminalBuildReason) {
    return {
      ok: false,
      pending: false,
      retryable: false,
      disposition: "system_hold",
      lead_rejection: false,
      prospect_id: id,
      business_name: firstValue(durableProspect || prospect, ["business_name", "businessName", "name", "company"], ""),
      status: String(durableProspect?.status || terminalBuildReason).trim() || terminalBuildReason,
      blocked: terminalBuildReason,
      reason: terminalBuildReason,
      persistence: "durable_terminal_state",
      siteforge_dispatched: false,
      autosend_created: false,
      prospect: durableProspect,
    };
  }
  const activeRevealClaim = source === "reveal_click"
    ? activeMirrorBuildClaim(durableProspect || {}, Number(nowFn()))
    : null;
  if (activeRevealClaim) {
    return {
      ok: false,
      pending: true,
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      prospect_id: id,
      business_name: firstValue(durableProspect || prospect, ["business_name", "businessName", "name", "company"], ""),
      status: String(durableProspect?.status || "new").trim() || "new",
      blocked: "mirror_build_in_flight",
      reason: "mirror_build_in_flight",
      persistence: "durable_build_claim",
      operation_key: activeRevealClaim.operation_key,
      source_fingerprint: activeRevealClaim.source_fingerprint,
      retry_after: activeRevealClaim.lease_expires_at,
      siteforge_dispatched: false,
      autosend_created: false,
      prospect: durableProspect,
    };
  }
  const durableConsent = recordedPositivePreviewConsent(durableProspect || {});
  if (!durableConsent.ok) {
    return {
      ok: false,
      pending: false,
      prospect_id: id,
      business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
      status: "held",
      blocked: durableConsent.reason,
      consent_store_status: durableLoad.ok ? "recorded_consent_missing" : durableLoad.blocked,
      persistence: "consent_not_verified",
      siteforge_dispatched: false,
      autosend_created: false,
      prospect,
    };
  }

  // The fresh store row is the source of truth for both authorization and
  // build input. A route can reach this function with a prospect loaded before
  // a concurrent source correction; rebasing prevents that stale wrapper from
  // choosing the Mirror payload, operation receipt, or final persisted record.
  // Runtime-only build choices remain explicit options (for example,
  // compositionSlot) instead of untrusted prospect overrides.
  const verifiedConsentRecord = {
    status: durableConsent.status,
    recorded_at: durableConsent.recordedAt,
    source: durableConsent.source,
  };
  prospect = {
    ...durableProspect,
    preview_build_consent: verifiedConsentRecord,
    record: {
      ...(isObject(durableProspect?.record) ? durableProspect.record : {}),
      preview_build_consent: verifiedConsentRecord,
    },
  };

  const persistPreProviderHold = async ({
    blockedReason,
    heldRecord,
  }) => {
    const baseUpdatedAt = String(prospect.updated_at || "").trim();
    const baseUpdatedAtMs = Date.parse(baseUpdatedAt);
    const requestedNow = Number(nowFn());
    const updatedAt = new Date(Math.max(
      Number.isFinite(requestedNow) ? requestedNow : Date.now(),
      Number.isFinite(baseUpdatedAtMs) ? baseUpdatedAtMs + 1 : 0,
    )).toISOString();
    const patch = {
      prospect_id: id,
      status: "held",
      report_url: null,
      preview_url: null,
      record: heldRecord,
      updated_at: updatedAt,
    };
    if (!persist) {
      return {
        proven: false,
        attempted: false,
        persistence: "not_persisted",
        patch,
      };
    }
    if (ownerBuildExpired()) {
      return {
        proven: false,
        attempted: false,
        deadline: true,
        persistence: "deadline_not_started",
        patch,
      };
    }
    const guards = reconciliationWriteGuards(prospect);
    if (!guards) {
      return {
        proven: false,
        attempted: false,
        persistence: "cas_identity_missing",
        patch,
      };
    }
    let result = null;
    try {
      result = await conditionalUpdateFn(
        "ghost_agency_prospects",
        "prospect_id",
        id,
        guards,
        patch,
      );
    } catch (_) {
      result = { mode: "live_update_failed", updated: false, rows: [] };
    }
    return {
      proven: directFinalPersistenceProven(result, { id, patch }),
      attempted: true,
      persistence: result?.mode || "live_update_failed",
      patch,
      blockedReason,
    };
  };

  const preProviderHoldPersistenceFailure = ({
    blockedReason,
    persistence,
    message,
    truthPacket: heldTruthPacket,
    intakeGenie,
  }) => ({
    ok: false,
    pending: true,
    retryable: true,
    disposition: "system_hold",
    lead_rejection: false,
    provider_attempted: false,
    manual_reconciliation_required: false,
    rebuild_allowed: true,
    redeploy_allowed: false,
    prospect_id: id,
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
    status: String(prospect.status || "new").trim() || "new",
    blocked: "mirror_prebuild_persistence_unproven",
    reason: "mirror_prebuild_persistence_unproven",
    cause_code: blockedReason,
    message,
    ...(intakeGenie === undefined ? {} : { intake_genie: intakeGenie }),
    ...(heldTruthPacket === undefined ? {} : { truth_packet: heldTruthPacket }),
    persistence,
    persistence_unproven: true,
    siteforge_dispatched: false,
    autosend_created: false,
    provider_calls: 0,
    prospect,
  });

  // A durable reconciliation hold is an already-published release, not a new
  // build candidate. Reveal polls can arrive after the final write succeeds
  // (or after its response is lost); replay the exact held evidence before
  // Intake Genie, hero work, Mirror, or any provider can run again. Invalid or
  // unverifiable held evidence also fails closed here instead of redeploying.
  const durableReconciliation = durableMirrorReconciliationFence(durableProspect || {});
  if (durableReconciliation) {
    const originalCode = safeDispatchCode(
      durableReconciliation.hold.code || durableReconciliation.dispatch.reason,
    ) || "mirror_fleet_record_unavailable";
    const blocked = durableReconciliation.valid
      ? originalCode
      : "mirror_reconciliation_evidence_invalid";
    const replayedHold = durableReconciliation.valid
      ? durableReconciliation.hold
      : {
          ...durableReconciliation.hold,
          code: blocked,
          cause_code: originalCode,
          retryable: true,
          scope: "mirror_reconciliation",
          provider_attempted: true,
          manual_reconciliation_required: true,
          rebuild_allowed: false,
          redeploy_allowed: false,
        };
    return {
      ok: false,
      pending: true,
      retryable: true,
      disposition: "system_hold",
      lead_rejection: false,
      provider_attempted: true,
      manual_reconciliation_required: true,
      rebuild_allowed: false,
      redeploy_allowed: false,
      prospect_id: id,
      business_name: firstValue(durableProspect || prospect, ["business_name", "businessName", "name", "company"], ""),
      status: "held",
      report_url: null,
      preview_url: null,
      blocked,
      reason: blocked,
      system_hold: replayedHold,
      reconciliation: durableReconciliation.reconciliation,
      release_evidence: durableReconciliation.releaseEvidence,
      persistence: durableReconciliation.valid
        ? "persisted_reconciliation_hold"
        : "persisted_reconciliation_evidence_invalid",
      siteforge_dispatched: false,
      autosend_created: false,
      truth_packet: durableProspect?.truth_packet || durableProspect?.record?.truth_packet || null,
      dispatch: durableReconciliation.dispatch,
      prospect: durableProspect,
    };
  }

  let truthPacket;
  const suppliedLeadMinerPacket = isLeadMinerMirrorReadyPacket(
    prospect.truth_packet,
    prospect.truth_packet_source,
  );
  if (suppliedLeadMinerPacket && !isCompleteLeadMinerMirrorReadyPacket(
    prospect.truth_packet,
    prospect.truth_packet_source,
  )) {
    const blockedReason = "leadminer_truth_packet_incomplete";
    const heldRecord = {
      ...recordForPersist(prospect),
      prospect_id: id,
      status: "held",
      blocked_reason: blockedReason,
      truth_packet: prospect.truth_packet,
      truth_packet_source: "leadminer_mirror_ready",
    };
    const holdPersistence = await persistPreProviderHold({ blockedReason, heldRecord });
    if (holdPersistence.deadline) return deadlineHold();
    if (persist && !holdPersistence.proven) {
      return preProviderHoldPersistenceFailure({
        blockedReason,
        persistence: holdPersistence.persistence,
        message: "LeadMiner payload is incomplete; discovery and SiteForge fallback are disabled.",
        truthPacket: prospect.truth_packet,
      });
    }
    return {
      ok: false,
      pending: false,
      prospect_id: id,
      business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
      status: "held",
      blocked: blockedReason,
      message: "LeadMiner payload is incomplete; discovery and SiteForge fallback are disabled.",
      truth_packet: prospect.truth_packet,
      persistence: holdPersistence.persistence,
      siteforge_dispatched: false,
      autosend_created: false,
      provider_calls: 0,
      prospect: heldRecord,
    };
  }
  if (isReusableTruthPacket(
    prospect.truth_packet,
    prospect.truth_packet_source,
    firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
  )) {
    truthPacket = prospect.truth_packet;
  } else {
    try {
      const truthAttempt = options.awaitTerminal === true
        ? await runBeforeDeadline(
            (signal) => truthPacketFn(prospect, source, {
              signal,
              deadlineAt: ownerBuildDeadlineAt,
            }),
            ownerBuildDeadlineAt,
            deadlineNowFn,
          )
        : { expired: false, value: await truthPacketFn(prospect, source) };
      if (truthAttempt.expired) return deadlineHold();
      truthPacket = truthAttempt.value;
    } catch (error) {
      const blockedReason = error.code || "intake_genie_blocked";
      const heldRecord = {
        ...recordForPersist(prospect),
        prospect_id: id,
        status: "held",
        blocked_reason: blockedReason,
        intake_genie_error: error.message,
        intake_genie_result: error.intakeGenie || null,
      };
      const holdPersistence = await persistPreProviderHold({ blockedReason, heldRecord });
      if (holdPersistence.deadline) return deadlineHold();
      if (persist && !holdPersistence.proven) {
        return preProviderHoldPersistenceFailure({
          blockedReason,
          persistence: holdPersistence.persistence,
          message: error.message,
          intakeGenie: error.intakeGenie || null,
        });
      }
      return {
        ok: false,
        prospect_id: id,
        business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
        status: "held",
        blocked: blockedReason,
        message: error.message,
        intake_genie: error.intakeGenie || null,
        persistence: holdPersistence.persistence,
        prospect: heldRecord,
      };
    }
  }
  if (ownerBuildExpired()) return deadlineHold();
  const buildProspect = {
    ...prospectBuildInput(prospect, truthPacket),
    ...(Number.isInteger(options.compositionSlot) && options.compositionSlot >= 0
      ? { composition_slot: options.compositionSlot }
      : {}),
  };
  const buildSourceFingerprint = mirrorBuildSourceFingerprint(buildProspect);
  if (!buildProspect.industry) {
    const blockedReason = "approved_vertical_required";
    const heldProspect = {
      ...recordForPersist(prospect),
      prospect_id: id,
      status: "held",
      blocked_reason: blockedReason,
    };
    const holdPersistence = await persistPreProviderHold({ blockedReason, heldRecord: heldProspect });
    if (holdPersistence.deadline) return deadlineHold();
    if (persist && !holdPersistence.proven) {
      return preProviderHoldPersistenceFailure({
        blockedReason,
        persistence: holdPersistence.persistence,
        message: "A verified approved vertical is required before SiteForge can build this prospect.",
        truthPacket,
      });
    }
    return {
      ok: false,
      prospect_id: id,
      business_name: buildProspect.business_name,
      status: "held",
      blocked: blockedReason,
      message: "A verified approved vertical is required before SiteForge can build this prospect.",
      prospect: heldProspect,
      truth_packet: truthPacket,
      persistence: holdPersistence.persistence,
    };
  }
  const job = buildCanonicalJob({ prospect: buildProspect, jobId: options.jobId || `siteforge_${id}_${Date.now()}` });
  let ownerProofClaimId = "";
  let ownerProofClaimUpdatedAt = "";
  let ownerProofClaimRow = null;
  if (options.awaitTerminal === true) {
    if (ownerBuildExpired()) return deadlineHold();
    const originalUpdatedAt = String(prospect.updated_at || "").trim();
    if (!originalUpdatedAt) {
      return {
        ok: false,
        pending: false,
        prospect_id: id,
        business_name: buildProspect.business_name,
        status: "held",
        blocked: "owner_proof_original_version_missing",
        persistence: "claim_not_attempted",
        prospect: buildProspect,
        truth_packet: truthPacket,
      };
    }
    ownerProofClaimId = randomUUID();
    const originalUpdatedAtMs = Date.parse(originalUpdatedAt);
    const requestedClaimMs = Number(nowFn());
    const claimNow = new Date(Math.max(
      Number.isFinite(requestedClaimMs) ? requestedClaimMs : Date.now(),
      Number.isFinite(originalUpdatedAtMs) ? originalUpdatedAtMs + 1 : 0,
    )).toISOString();
    ownerProofClaimUpdatedAt = claimNow;
    const priorIntent = isObject(prospect[AUTOSEND_KEY]) ? prospect[AUTOSEND_KEY] : {};
    const claimRecord = {
      ...recordForPersist(prospect),
      ...recordForPersist(buildProspect),
      prospect_id: id,
      [AUTOSEND_KEY]: {
        ...priorIntent,
        run_id: options.runId || priorIntent.run_id || "",
        sandbox_mode: true,
        status: "owner_proof_claimed",
        claim_id: ownerProofClaimId,
        claimed_at: claimNow,
      },
    };
    let claimResult;
    try {
      if (persist) {
        const claimAttempt = await runBeforeDeadline(
          (signal) => conditionalUpdateFn(
              "ghost_agency_prospects",
              "prospect_id",
              id,
              { updated_at: `eq.${originalUpdatedAt}` },
              {
                record: claimRecord,
                updated_at: claimNow,
              },
              { signal, deadlineAt: ownerBuildDeadlineAt },
            ),
          ownerBuildDeadlineAt,
          deadlineNowFn,
        );
        claimResult = claimAttempt.expired
          ? { mode: "owner_proof_build_deadline_exhausted", updated: false }
          : claimAttempt.value;
      } else {
        claimResult = { mode: "not_persisted" };
      }
    } catch (_) {
      claimResult = { mode: "live_update_failed", updated: false };
    }
    const claimedRows = Array.isArray(claimResult?.rows) ? claimResult.rows : [];
    const claimProven = claimResult?.mode === "live_update"
      && claimResult.updated === true
      && claimedRows.length === 1
      && claimedRows.some((row) => (
        row?.prospect_id === id
        && sameInstant(row?.updated_at, claimNow)
        && row?.record?.[AUTOSEND_KEY]?.status === "owner_proof_claimed"
        && row.record[AUTOSEND_KEY].claim_id === ownerProofClaimId
      ));
    if (!claimProven) {
      return {
        ok: false,
        pending: false,
        prospect_id: id,
        business_name: buildProspect.business_name,
        status: "held",
        blocked: "owner_proof_autosend_claim_unproven",
        persistence: claimResult?.mode || "claim_failed",
        prospect: buildProspect,
        truth_packet: truthPacket,
      };
    }
    ownerProofClaimRow = claimedRows[0];
  }
  const prospectRecord = prospect.record && typeof prospect.record === "object" ? prospect.record : {};
  const durableProspectRecord = isObject(durableProspect?.record) ? durableProspect.record : {};
  const historicalLegacyDispatch = legacyBuildDispatchForHistory(durableProspectRecord);
  const historicalForgeJob = isObject(durableProspectRecord.forge_job) ? durableProspectRecord.forge_job : null;
  const leadMinerBuild = isLeadMinerMirrorReadyPacket(truthPacket, prospect.truth_packet_source);

  // LEGACY DRAIN, READ-ONLY. The reconciler is the sole caller allowed to read
  // an already-persisted SiteForge job. It must provide its dedicated status
  // reader, and the freshly loaded row must pass the exact pending-state check
  // above. A normal build request, freshDispatch, a completed job, a request
  // body "resume", or the old default dispatcher can never reach this branch.
  const legacyResume = source === "siteforge_reconcile"
    && options.freshDispatch !== true
    && options.forceFreshDispatch !== true
    ? legacySiteForgePendingResume(durableProspect, id)
    : null;
  const legacyStatusReader = typeof options.dispatchSiteForgePreview === "function"
    ? options.dispatchSiteForgePreview
    : null;
  const legacyDrain = Boolean(legacyResume && legacyStatusReader);
  const buildOperationKey = String(options.operationKey || stableMirrorBuildOperationKey({
    prospectId: id,
    sourceFingerprint: buildSourceFingerprint,
    compositionSlot: options.compositionSlot,
  })).trim();
  let finalWriteBaseProspect = durableProspect;
  let revealBuildClaimRow = null;
  if (source === "reveal_click" && !legacyDrain && options.awaitTerminal !== true) {
    const claimGuards = reconciliationWriteGuards(durableProspect || {});
    const originalUpdatedAtMs = Date.parse(String(durableProspect?.updated_at || ""));
    const requestedClaimMs = Number(nowFn());
    const claimMs = Math.max(
      Number.isFinite(requestedClaimMs) ? requestedClaimMs : Date.now(),
      Number.isFinite(originalUpdatedAtMs) ? originalUpdatedAtMs + 1 : 0,
    );
    const claimedAt = new Date(claimMs).toISOString();
    const leaseExpiresAt = new Date(claimMs + MIRROR_REVEAL_CLAIM_LEASE_MS).toISOString();
    const claimId = randomUUID();
    const claim = {
      schema: "wss.mirror.build_claim.v1",
      state: "in_flight",
      claim_id: claimId,
      operation_key: buildOperationKey,
      source_fingerprint: buildSourceFingerprint,
      claimed_at: claimedAt,
      lease_expires_at: leaseExpiresAt,
    };
    let claimResult;
    try {
      claimResult = persist && claimGuards
        ? await conditionalUpdateFn(
            "ghost_agency_prospects",
            "prospect_id",
            id,
            claimGuards,
            {
              record: {
                ...durableProspectRecord,
                [MIRROR_REVEAL_CLAIM_KEY]: claim,
              },
              updated_at: claimedAt,
            },
            { signal: options.signal, deadlineAt: ownerBuildDeadlineAt || options.deadlineAt },
          )
        : {
            mode: persist ? "mirror_build_claim_identity_missing" : "not_persisted",
            updated: false,
            rows: [],
          };
    } catch (_) {
      claimResult = { mode: "live_update_failed", updated: false, rows: [] };
    }
    revealBuildClaimRow = mirrorBuildClaimProven(claimResult, {
      id,
      updatedAt: claimedAt,
      status: String(durableProspect?.status || "").trim(),
      claimId,
      operationKey: buildOperationKey,
      sourceFingerprint: buildSourceFingerprint,
      leaseExpiresAt,
    });
    if (!revealBuildClaimRow) {
      return {
        ok: false,
        pending: true,
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        prospect_id: id,
        business_name: buildProspect.business_name,
        status: String(durableProspect?.status || "new").trim() || "new",
        blocked: "mirror_build_claim_unproven",
        reason: "mirror_build_claim_unproven",
        persistence: claimResult?.mode || "claim_failed",
        operation_key: buildOperationKey,
        source_fingerprint: buildSourceFingerprint,
        siteforge_dispatched: false,
        autosend_created: false,
        prospect: durableProspect,
        truth_packet: truthPacket,
      };
    }
    finalWriteBaseProspect = prospectFromRow(revealBuildClaimRow);
  }

  // START THE COUTURE LANE BESIDE THE BUILD. By this point the durable row,
  // recorded consent, approved vertical and truth packet have all passed. Use
  // the fresh durable record as the base so the desktop worker sees the photo
  // bank even when the caller supplied a narrower prospect wrapper. The one
  // awaited operation is the idempotent job write; no Google/browser work can
  // run in this request. Legacy-drain reads, dry runs and explicit non-durable
  // calls remain side-effect free. Starting before dispatch is intentional:
  // this is the qualification boundary, so image work overlaps the mirror;
  // a later mirror refusal cannot publish the clip and owner approval still
  // gates the worker, while moving this after success would force a second
  // build every time and restore the idle time this lane removes.
  let heroRemasterStart = null;
  if (!legacyDrain) {
    // The photo bank is identity evidence. Never let a request/build wrapper
    // replace the freshly loaded durable record (including photo_bank or its
    // legacy-site lineage). A caller may carry richer display fields, but the
    // queue's source proof must come only from the row that passed the consent
    // read above.
    const heroJobRecord = { ...durableProspectRecord };
    if (!heroJobRecord.current_website && durableProspect?.current_website) {
      heroJobRecord.current_website = durableProspect.current_website;
    }
    const heroJobProspect = {
      ...buildProspect,
      ...(isObject(durableProspect) ? durableProspect : {}),
      record: heroJobRecord,
    };
    heroRemasterStart = await enqueueHeroRemasterForBuild(heroJobProspect, {
      dryRun: options.dryRun === true,
      persist,
      env: options.env || process.env,
      enqueueHeroReelJob: options.enqueueHeroReelJob,
      deadlineAt: ownerBuildDeadlineAt,
      now: deadlineNowFn,
    });
  }

  let dispatch;
  if (legacyDrain) {
    try {
      const observed = await legacyStatusReader({
        prospect: buildProspect,
        job,
        truthPacket,
        resume: legacyResume,
        awaitTerminal: false,
        buildDeadlineAt: ownerBuildDeadlineAt,
        deadlineAt: ownerBuildDeadlineAt,
      });
      // The dedicated reader identifies itself. Rejecting every other mode is
      // what prevents an injected copy of dispatchSiteForgePreview from
      // turning a failed GET into its historical fresh-POST fallback.
      dispatch = observed?.mode === "existing_job_status_read"
        ? observed
        : {
            mode: "legacy_siteforge_status_read_refused",
            configured: true,
            pending: false,
            fail_closed: true,
            reason: "legacy_siteforge_status_reader_required",
            blocked: ["legacy_siteforge_status_reader_required"],
            urls: {},
            buildStatus: {
              ready: false,
              pending: false,
              renderer: REQUIRED_RENDERER,
              required_renderer: REQUIRED_RENDERER,
              qc_passed: false,
              visual_qc_passed: false,
              blocked: ["legacy_siteforge_status_reader_required"],
            },
          };
    } catch (error) {
      dispatch = {
        mode: "legacy_siteforge_status_read_failed",
        configured: true,
        pending: false,
        fail_closed: true,
        error: error.message || boundedDetailText(error),
        blocked: ["legacy_siteforge_status_read_failed"],
        urls: {},
        buildStatus: {
          ready: false,
          pending: false,
          renderer: REQUIRED_RENDERER,
          required_renderer: REQUIRED_RENDERER,
          qc_passed: false,
          visual_qc_passed: false,
          blocked: ["legacy_siteforge_status_read_failed"],
        },
      };
    }
  } else {
    // ALL FRESH BUILDS USE MIRROR ENGINE. There is no Forge/SiteForge shortcut
    // after this call and no feature flag that can route around a refusal.
    try {
      const runMirror = (signal) => dispatchMirrorLane(buildProspect, {
        dryRun: options.dryRun === true,
        buildMirror: options.buildMirrorForProspect,
        operationKey: buildOperationKey,
        signal: options.signal || signal,
        deadlineAt: ownerBuildDeadlineAt || options.deadlineAt,
        onRefusal: options.onMirrorRefusal,
      });
      if (options.awaitTerminal === true) {
        const attempt = await runBeforeDeadline(runMirror, ownerBuildDeadlineAt, deadlineNowFn);
        dispatch = attempt.expired
          ? blockedLeadMinerMirrorDispatch("owner_proof_build_deadline_exhausted")
          : attempt.value;
      } else {
        dispatch = await runMirror(options.signal);
      }
      if (!dispatch) {
        dispatch = blockedLeadMinerMirrorDispatch(
          leadMinerBuild ? "leadminer_mirror_build_refused" : "mirror_engine_build_refused",
        );
      }
    } catch (error) {
      dispatch = blockedLeadMinerMirrorDispatch(
        leadMinerBuild ? "leadminer_mirror_dispatch_exception" : "mirror_engine_dispatch_exception",
        [boundedDetailText(error && error.message ? error.message : error, 300)],
      );
      dispatch.error = error.message || boundedDetailText(error);
    }
  }

  if (isObject(dispatch)) dispatch.source_fingerprint = buildSourceFingerprint;

  const pending = Boolean(dispatch.pending || dispatch.buildStatus?.pending);
  const ready = !pending && Boolean(dispatch.buildStatus && dispatch.buildStatus.ready);
  const systemHold = dispatch.disposition === "system_hold"
    && dispatch.retryable === true
    && dispatch.lead_rejection === false;
  // A fleet-record outage happens AFTER the renderer/provider published the
  // release. It is retryable only as a manual registry reconciliation; putting
  // the prospect back in `new` would let nightly build and deploy it again.
  const manualReconciliationHold = systemHold && (
    dispatch.provider_attempted === true
    || dispatch.manual_reconciliation_required === true
    || dispatch.system_hold?.manual_reconciliation_required === true
    || dispatch.system_hold?.scope === "mirror_reconciliation"
  );
  const urls = dispatch.urls || {};
  // Only a pre-existing legacy job stays `new` while its read-only drain is
  // pending. Every fresh Mirror refusal is held, regardless of packet source;
  // otherwise the same row can be picked forever as if no build was attempted.
  const nextStatus = ready
    ? "previewed"
    : ((legacyDrain && pending) || (systemHold && !manualReconciliationHold))
      ? "new"
      : "held";
  const reportUrl = ready ? urls.report_url : firstValue(prospect, ["report_url", "reportUrl"]);
  // A non-ready rebuild RETAINS whatever preview URL the prospect already had.
  // That is how a stale URL on the retired rocketsites host survived every
  // rebuild attempt and kept getting re-emailed. Sanitize both the fresh and the
  // retained value: anything not on an approved wss-ai.com host is dropped so it
  // can never be persisted and re-sent — the prospect simply holds until a real
  // build lands.
  // A completed Forge/SiteForge URL may remain in the historical record, but
  // it cannot short-circuit or replace the URL returned by THIS build. When the
  // new build is not ready, the old URL is retained only as non-passing history:
  // ready/QC/evidence are all false or empty and the public result returns null.
  const previewUrl = sanitizePreviewUrl(
    ready ? urls.preview_url : firstValue(prospect, ["preview_url", "previewUrl"]),
  );
  const checkoutUrl = dispatch.payload?.prospect?.checkout_url || firstValue(prospect, ["checkout_url", "checkoutUrl"]);
  const authoritySummary = dispatch.authoritySummary || null;
  const optimizationManifestUrl = dispatch.optimizationManifestUrl || "";
  // Release evidence is build-specific. Never carry an older envelope onto a
  // fresh dispatch response that did not prove its own QC artifacts.
  const releaseEvidence = dispatch.releaseEvidence || dispatch.release_evidence || dispatch.buildStatus?.release_evidence || null;
  // THE SHIPPED ACCENT, MADE DURABLE. The engine's site-chrome-vs-logo
  // arbitration can paint the mirror in a colour no brand field on the record
  // carries — it lived only inside release_evidence.checks.brand, which the
  // email side never opens, so site and email could dress in different
  // colours. Distilled here into record.brand_truth, the field verifiedBrandOf
  // (the declared single reader) prefers FIRST. Null when this dispatch proved
  // no shipped hex — and then the merge below simply keeps whatever
  // brand_truth an earlier build already wrote.
  const shippedBrandTruth = brandTruthFromEvidence(releaseEvidence);
  const completedPhotoBank = ready
    ? completedOwnedHeroBank(
      dispatch,
      {
        ...durableProspectRecord,
        current_website: durableProspectRecord.current_website || durableProspect?.current_website,
      },
      new Date(Number(nowFn()) || Date.now()),
    )
    : null;
  const priorSiteForgeCallback = isObject(prospect.siteforge_callback)
    ? prospect.siteforge_callback
    : isObject(prospectRecord.siteforge_callback)
      ? prospectRecord.siteforge_callback
      : {};
  // The authenticated SiteForge route recompiles the source packet before it
  // renders. Preserve that fresher packet instead of re-saving the stale
  // pre-dispatch wrapper that Ghost sent in the request.
  const latestTruthPacket = isObject(dispatch.truthPacket) && isObject(dispatch.truthPacket.facts)
    ? truthPacketFromCanonical(dispatch.truthPacket)
    : truthPacket;
  const enrichedTruthPacket = authoritySummary
    ? { ...latestTruthPacket, authority_standard: authoritySummary }
    : latestTruthPacket;
  const blockedReason = ready
    ? ""
    : systemHold
      ? (dispatch.reason || dispatch.system_hold?.code || "mirror_system_hold")
    : (legacyDrain && pending)
      ? "siteforge_build_pending"
      : pending
        ? "mirror_engine_pending_not_supported"
        : buildBlockReason(dispatch);
  const dispatchDetails = dispatchSummary(dispatch);
  const requestedFinalMs = Number(nowFn());
  const claimedAtMs = Date.parse(ownerProofClaimUpdatedAt);
  let finalUpdatedAt = new Date(options.awaitTerminal === true
    ? Math.max(
        Number.isFinite(requestedFinalMs) ? requestedFinalMs : Date.now(),
        Number.isFinite(claimedAtMs) ? claimedAtMs + 1 : 0,
      )
    : (Number.isFinite(requestedFinalMs) ? requestedFinalMs : Date.now())).toISOString();
  if (finalWriteBaseProspect) {
    const claimVersionMs = Date.parse(String(finalWriteBaseProspect.updated_at || ""));
    finalUpdatedAt = new Date(Math.max(
      Date.parse(finalUpdatedAt),
      Number.isFinite(claimVersionMs) ? claimVersionMs + 1 : 0,
    )).toISOString();
  }
  const mergedRecord = {
    // Both are row-derived (prospectFromRow), so both still carry `record`.
    ...recordForPersist(prospect),
    ...recordForPersist(buildProspect),
    prospect_id: id,
    status: nextStatus,
    report_url: reportUrl || null,
    preview_url: previewUrl || null,
    preview_expires_at: null,
    checkout_url: checkoutUrl || null,
    truth_packet: enrichedTruthPacket,
    authority_summary: authoritySummary,
    optimization_manifest_url: optimizationManifestUrl || null,
    truth_packet_source: truthPacket.meta?.source || source,
    build_dispatch: dispatchDetails,
    // Historical producers stay inspectable, but neither field participates in
    // the current quality/send gates. Current proof lives only in
    // build_dispatch + release_evidence from THIS Mirror build (or the one
    // exact legacy job being drained).
    ...(historicalLegacyDispatch ? { legacy_build_dispatch: historicalLegacyDispatch } : {}),
    ...(historicalForgeJob ? { forge_job: historicalForgeJob } : {}),
    siteforge_qc_passed: ready,
    siteforge_visual_qc_passed: Boolean(dispatch.buildStatus?.visual_qc_passed),
    siteforge_qc_contract: dispatch.buildStatus?.qc_contract || null,
    siteforge_renderer: dispatch.buildStatus?.renderer || null,
    siteforge_generation_fingerprint: dispatch.buildStatus?.generation_fingerprint || null,
    release_evidence: releaseEvidence,
    truth_packet: dispatch.truth_packet || enrichedTruthPacket,
    // A first build often creates this bank while Mirror is harvesting. The
    // old flow discarded it here, so the pre-build Ads job saw zero photos and
    // every served hero stayed on stock. Persist only the queue-normalized,
    // provenance-complete form; an unverified candidate remains absent.
    ...(completedPhotoBank ? { photo_bank: completedPhotoBank } : {}),
    // The decided accent from THIS build's evidence — see shippedBrandTruth
    // above. Spread-conditional so a dispatch with no shipped hex cannot
    // erase the truth an earlier revealable build persisted.
    ...(shippedBrandTruth ? { brand_truth: shippedBrandTruth } : {}),
    siteforge_callback: {
      ...priorSiteForgeCallback,
      release_evidence: releaseEvidence,
    },
    blocked_reason: blockedReason || null,
    packets: job.packets,
  };

  // A synchronous owner proof either sends inline from this request or holds.
  // Remove any older async intent so the reconciler cannot send a second owner
  // email after this run has already delivered its proof.
  if (options.awaitTerminal === true) delete mergedRecord[AUTOSEND_KEY];

  // Build completion never authorizes an email. If an old caller supplied the
  // retired autosend option, record no intent; post-reply delivery is explicit.
  if (isObject(mergedRecord[AUTOSEND_KEY])
    && mergedRecord[AUTOSEND_KEY].status === "pending") {
    mergedRecord[AUTOSEND_KEY] = abandonPendingAutosend(mergedRecord[AUTOSEND_KEY]);
  }
  // A proven reveal claim is only a lease around provider work. The final CAS
  // either publishes this patch (and clears the lease) or misses and leaves the
  // durable claim in place to fence an immediate duplicate retry.
  if (revealBuildClaimRow) delete mergedRecord[MIRROR_REVEAL_CLAIM_KEY];

  let finalPatch = {
    status: nextStatus,
    report_url: reportUrl || null,
    preview_url: previewUrl || null,
    preview_expires_at: null,
    record: mergedRecord,
    updated_at: finalUpdatedAt,
  };
  let row;
  if (options.awaitTerminal === true) {
    try {
      if (persist) {
        const finalAttempt = await runBeforeDeadline(
          (signal) => conditionalUpdateFn(
              "ghost_agency_prospects",
              "prospect_id",
              id,
              {
                updated_at: `eq.${ownerProofClaimUpdatedAt}`,
                "record->autosend->>claim_id": `eq.${ownerProofClaimId}`,
              },
              finalPatch,
              { signal, deadlineAt: ownerRequestDeadlineAt },
            ),
          ownerRequestDeadlineAt,
          deadlineNowFn,
        );
        row = finalAttempt.expired
          ? { mode: "owner_proof_request_deadline_exhausted", updated: false, rows: [] }
          : finalAttempt.value;
      } else {
        row = { mode: "not_persisted", updated: false, rows: [] };
      }
    } catch (_) {
      row = { mode: "live_update_failed", updated: false, rows: [] };
    }
    const finalRows = Array.isArray(row?.rows) ? row.rows : [];
    const expectedFinal = () => ({
      id,
      updatedAt: finalUpdatedAt,
      status: nextStatus,
      reportUrl,
      previewUrl,
      ready,
      visualQcPassed: Boolean(dispatch.buildStatus?.visual_qc_passed),
      qcContract: dispatch.buildStatus?.qc_contract,
      renderer: dispatch.buildStatus?.renderer,
      generationFingerprint: dispatch.buildStatus?.generation_fingerprint,
      dispatchReady: dispatchDetails.ready,
      dispatchPending: dispatchDetails.pending,
      jobId: dispatchDetails.job_id,
      releaseEvidence,
    });
    let finalPersistenceProven = row?.mode === "live_update"
      && row.updated === true
      && finalRows.length === 1
      && ownerFinalPersistenceProven(finalRows[0], expectedFinal());

    // SiteForge's callback/reconciler may update the prospect while this
    // request owns it. That changes updated_at and makes the first CAS miss,
    // even though the unique owner claim is still intact. Re-read once. An
    // exact final row proves a lost PATCH response; an exact surviving claim
    // permits one guarded rebase without weakening any build or identity gate.
    if (!finalPersistenceProven && persist && !deadlineExpired(ownerRequestDeadlineAt, deadlineNowFn)) {
      const readAttempt = await runBeforeDeadline(
        () => selectFn("ghost_agency_prospects", persistedProspectQuery([id])),
        ownerRequestDeadlineAt,
        deadlineNowFn,
      ).catch(() => ({ expired: false, value: null }));
      const readRows = readAttempt.expired || readAttempt.value?.ok !== true || !Array.isArray(readAttempt.value.data)
        ? []
        : readAttempt.value.data;
      const currentRow = readRows.length === 1 ? readRows[0] : null;
      if (ownerFinalPersistenceProven(currentRow, expectedFinal())) {
        row = { ok: true, mode: "live_update_reread_verified", updated: true, rows: [currentRow] };
        finalPersistenceProven = true;
      } else {
        const currentRecord = isObject(currentRow?.record) ? currentRow.record : {};
        const claimStillOwned = ownerFinalRebaseSafe(currentRow, ownerProofClaimRow, {
          id,
          claimId: ownerProofClaimId,
          status: nextStatus,
        });
        const exactReadyBuildLostClaim = ownerFinalBuildReacquireSafe(currentRow, expectedFinal());
        if ((claimStillOwned || exactReadyBuildLostClaim)
          && !deadlineExpired(ownerRequestDeadlineAt, deadlineNowFn)) {
          const currentUpdatedAtMs = Date.parse(currentRow.updated_at);
          const retryRequestedMs = Number(nowFn());
          finalUpdatedAt = new Date(Math.max(
            Number.isFinite(retryRequestedMs) ? retryRequestedMs : Date.now(),
            Number.isFinite(currentUpdatedAtMs) ? currentUpdatedAtMs + 1 : 0,
            Date.parse(finalUpdatedAt),
          )).toISOString();
          finalPatch = {
            ...finalPatch,
            record: ownerFinalRecordRebased(currentRecord, mergedRecord),
            updated_at: finalUpdatedAt,
          };
          const retryAttempt = await runBeforeDeadline(
            (signal) => conditionalUpdateFn(
              "ghost_agency_prospects",
              "prospect_id",
              id,
              claimStillOwned
                ? {
                    updated_at: `eq.${currentRow.updated_at}`,
                    "record->autosend->>claim_id": `eq.${ownerProofClaimId}`,
                  }
                : {
                    updated_at: `eq.${currentRow.updated_at}`,
                    status: `eq.${nextStatus}`,
                    "record->autosend": "is.null",
                    "record->build_dispatch->>job_id": `eq.${dispatchDetails.job_id}`,
                    "record->build_dispatch->>generation_fingerprint": `eq.${dispatchDetails.generation_fingerprint}`,
                    "record->build_dispatch->>ready": "eq.true",
                    "record->build_dispatch->>pending": "eq.false",
                    "record->build_dispatch->>qc_passed": "eq.true",
                    "record->build_dispatch->>visual_qc_passed": "eq.true",
                    // Match THIS dispatch's asserted identity, not the SiteForge
                    // constant — forge-lane rows carry ghost-forge-mirror-v1 and
                    // must prove the same value everywhere, not be excluded.
                    "record->build_dispatch->>renderer": `eq.${dispatchDetails.renderer}`,
                    "record->build_dispatch->>qc_contract": `eq.${dispatchDetails.qc_contract}`,
                    "record->build_dispatch->>report_url": postgrestScalarGuard(reportUrl),
                    "record->build_dispatch->>preview_url": postgrestScalarGuard(previewUrl),
                    "record->>prospect_id": `eq.${id}`,
                    "record->>siteforge_qc_passed": "eq.true",
                    "record->>siteforge_visual_qc_passed": "eq.true",
                    "record->>siteforge_renderer": `eq.${dispatchDetails.renderer}`,
                    "record->>siteforge_qc_contract": `eq.${dispatchDetails.qc_contract}`,
                    "record->>siteforge_generation_fingerprint": `eq.${dispatchDetails.generation_fingerprint}`,
                  },
              finalPatch,
              { signal, deadlineAt: ownerRequestDeadlineAt },
            ),
            ownerRequestDeadlineAt,
            deadlineNowFn,
          ).catch(() => ({ expired: false, value: null }));
          const retryRows = retryAttempt.expired || !Array.isArray(retryAttempt.value?.rows)
            ? []
            : retryAttempt.value.rows;
          if (retryAttempt.value?.mode === "live_update"
            && retryAttempt.value.updated === true
            && retryRows.length === 1
            && ownerFinalPersistenceProven(retryRows[0], expectedFinal())) {
            row = retryAttempt.value;
            finalPersistenceProven = true;
          } else if (!deadlineExpired(ownerRequestDeadlineAt, deadlineNowFn)) {
            const retryReadAttempt = await runBeforeDeadline(
              () => selectFn("ghost_agency_prospects", persistedProspectQuery([id])),
              ownerRequestDeadlineAt,
              deadlineNowFn,
            ).catch(() => ({ expired: false, value: null }));
            const retryReadRows = retryReadAttempt.expired
              || retryReadAttempt.value?.ok !== true
              || !Array.isArray(retryReadAttempt.value.data)
              ? []
              : retryReadAttempt.value.data;
            if (retryReadRows.length === 1
              && ownerFinalPersistenceProven(retryReadRows[0], expectedFinal())) {
              row = {
                ok: true,
                mode: "live_update_retry_reread_verified",
                updated: true,
                rows: retryReadRows,
              };
              finalPersistenceProven = true;
            }
          }
        }
      }
    }
    if (!finalPersistenceProven) {
      return {
        ok: false,
        pending: false,
        prospect_id: id,
        business_name: buildProspect.business_name,
        status: "held",
        report_url: null,
        preview_url: null,
        blocked: "owner_proof_final_persistence_unproven",
        persistence: row?.mode || "final_write_failed",
        prospect: buildProspect,
        truth_packet: enrichedTruthPacket,
      };
    }
  } else {
    if (persist) {
      try {
        // Every final build write is a version/contact/consent CAS. Admin,
        // Riley and cron callers cross the same provider boundary as reveal;
        // none may overwrite a STOP or source correction that landed while
        // Mirror was running.
        const guards = reconciliationWriteGuards(finalWriteBaseProspect || {});
        row = guards
          ? await conditionalUpdateFn(
              "ghost_agency_prospects",
              "prospect_id",
              id,
              guards,
              finalPatch,
            )
          : { mode: "mirror_final_guard_identity_missing", updated: false, rows: [] };
      } catch (_) {
        row = {
          mode: "live_update_failed",
          configured: true,
          updated: false,
          rows: [],
        };
      }
    } else {
      row = { mode: "not_persisted", configured: false };
    }

    if (persist
      && !manualReconciliationHold
      && !directFinalPersistenceProven(row, { id, patch: finalPatch })) {
      const providerAttempted = ready || dispatchDetails.provider_attempted === true;
      return {
        ok: false,
        pending: true,
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        prospect_id: id,
        business_name: buildProspect.business_name,
        status: String(finalWriteBaseProspect?.status || "new").trim() || "new",
        report_url: null,
        preview_url: null,
        blocked: "mirror_final_persistence_unproven",
        reason: "mirror_final_persistence_unproven",
        persistence: row?.mode || "final_write_failed",
        provider_attempted: providerAttempted,
        manual_reconciliation_required: providerAttempted,
        rebuild_allowed: providerAttempted ? false : undefined,
        redeploy_allowed: providerAttempted ? false : undefined,
        operation_key: buildOperationKey,
        source_fingerprint: buildSourceFingerprint,
        release_evidence: releaseEvidence || null,
        siteforge_dispatched: false,
        truth_packet: enrichedTruthPacket,
        dispatch: dispatchDetails,
        prospect: buildProspect,
      };
    }

    const finalReconciliationProven = manualReconciliationHold
      ? reconciliationPersistenceProven(row, {
          id,
          updatedAt: finalUpdatedAt,
          reconciliation: dispatchDetails.reconciliation,
          releaseEvidence,
        })
      : true;
    if (manualReconciliationHold && !finalReconciliationProven) {
      const code = "mirror_reconciliation_persistence_unproven";
      const priorHold = isObject(dispatchDetails.system_hold) ? dispatchDetails.system_hold : {};
      const persistenceHold = {
        ...priorHold,
        schema: safeDispatchCode(priorHold.schema) || "wss.mirror.system_hold.v1",
        type: "system",
        code,
        retryable: true,
        scope: "mirror_reconciliation",
        provider_attempted: true,
        manual_reconciliation_required: true,
        rebuild_allowed: false,
        redeploy_allowed: false,
        persistence_unproven: true,
        cause_code: safeDispatchCode(priorHold.code || dispatch.reason) || "mirror_fleet_record_unavailable",
        ...(dispatchDetails.reconciliation ? { reconciliation: dispatchDetails.reconciliation } : {}),
      };
      const durableStatus = String(
        durableProspect?.status
        || durableProspectRecord.status
        || prospect.status
        || "new",
      ).trim() || "new";
      return {
        ok: false,
        pending: true,
        retryable: true,
        disposition: "system_hold",
        lead_rejection: false,
        provider_attempted: true,
        manual_reconciliation_required: true,
        rebuild_allowed: false,
        redeploy_allowed: false,
        persistence_unproven: true,
        prospect_id: id,
        business_name: buildProspect.business_name,
        // Do not claim the durable row is held when the exact write was not
        // confirmed. The stable buildOperationKey above is the no-redeploy
        // fence for the next poll; it may retry only this exact release.
        status: durableStatus,
        report_url: null,
        preview_url: null,
        blocked: code,
        reason: code,
        system_hold: persistenceHold,
        reconciliation: dispatchDetails.reconciliation,
        release_evidence: releaseEvidence || null,
        persistence: row?.mode || "final_write_failed",
        siteforge_dispatched: false,
        legacy_siteforge_drained: legacyDrain,
        truth_packet: enrichedTruthPacket,
        dispatch: {
          ...dispatchDetails,
          reason: code,
          provider_attempted: true,
          manual_reconciliation_required: true,
          system_hold: persistenceHold,
        },
        prospect: buildProspect,
      };
    }
  }

  // SECOND CHANCE AT BUILD COMPLETION. A successful Mirror may have produced
  // the first durable owned-photo bank for this prospect. Always offer that
  // verified bank to the idempotent queue after persistence: an early
  // website-only Seedance job may already have refused for lack of a scene,
  // and the queue's prospect key + CAS refreshes that SAME job. This remains
  // fail-soft and bounded:
  // Google/Chrome never runs in this request, and any queue/provider failure
  // leaves the already-proven stock-fallback build untouched.
  if (
    ready
    && completedPhotoBank
    && persist
    && !legacyDrain
  ) {
    await enqueueHeroRemasterForBuild({
      ...buildProspect,
      ...(isObject(durableProspect) ? durableProspect : {}),
      preview_url: previewUrl,
      record: mergedRecord,
    }, {
      dryRun: options.dryRun === true,
      persist,
      env: options.env || process.env,
      enqueueHeroReelJob: options.enqueueHeroReelJob,
      deadlineAt: ownerBuildDeadlineAt,
      now: deadlineNowFn,
    });
  }

  return {
    ok: ready,
    pending,
    retryable: systemHold ? true : undefined,
    disposition: systemHold ? "system_hold" : undefined,
    lead_rejection: systemHold ? false : undefined,
    reason: systemHold ? (dispatch.reason || dispatch.system_hold?.code || "mirror_system_hold") : undefined,
    system_hold: systemHold ? dispatchDetails.system_hold : undefined,
    provider_attempted: systemHold ? dispatchDetails.provider_attempted : undefined,
    manual_reconciliation_required: systemHold
      ? dispatchDetails.manual_reconciliation_required
      : undefined,
    rebuild_allowed: manualReconciliationHold ? false : undefined,
    redeploy_allowed: manualReconciliationHold ? false : undefined,
    reconciliation: systemHold ? dispatchDetails.reconciliation : undefined,
    prospect_id: id,
    business_name: buildProspect.business_name,
    status: nextStatus,
    report_url: ready ? reportUrl : null,
    preview_url: ready ? previewUrl : null,
    preview_expires_at: null,
    checkout_url: ready ? checkoutUrl : null,
    optimization_manifest_url: ready ? optimizationManifestUrl || null : null,
    authority_summary: ready ? authoritySummary : null,
    renderer: dispatch.buildStatus?.renderer || null,
    required_renderer: dispatch.buildStatus?.required_renderer
      || (legacyDrain ? REQUIRED_RENDERER : MIRROR_ENGINE_RENDERER),
    generation_fingerprint: dispatch.buildStatus?.generation_fingerprint || null,
    qc_passed: Boolean(dispatch.buildStatus?.qc_passed),
    visual_qc_passed: Boolean(dispatch.buildStatus?.visual_qc_passed),
    qc_contract: dispatch.buildStatus?.qc_contract || null,
    required_qc_contract: dispatch.buildStatus?.required_qc_contract
      || (legacyDrain ? REQUIRED_QC_CONTRACT : MIRROR_ENGINE_QC_CONTRACT),
    grade: dispatch.buildStatus?.grade || null,
    blocked: blockedReason || undefined,
    error_code: dispatchDetails.error_code,
    error: dispatchDetails.error,
    http_status: dispatchDetails.http_status,
    // SiteForge's real rejection, surfaced so operators see the true cause
    // (e.g. source_evidence_incomplete + which artifact was missing).
    siteforge_code: dispatch.buildStatus?.siteforge_code || null,
    siteforge_error: dispatch.buildStatus?.siteforge_error || null,
    siteforge_missing: dispatch.buildStatus?.siteforge_missing || null,
    siteforge_http_status: dispatch.buildStatus?.siteforge_http_status ?? null,
    persistence: row.mode || row.status,
    siteforge_dispatched: false,
    legacy_siteforge_drained: legacyDrain,
    truth_packet: enrichedTruthPacket,
    release_evidence: releaseEvidence || null,
    dispatch: dispatchDetails,
    prospect: {
      ...buildProspect,
      truth_packet: enrichedTruthPacket,
      authority_summary: authoritySummary,
      optimization_manifest_url: optimizationManifestUrl || null,
      report_url: ready ? reportUrl : buildProspect.report_url,
      preview_url: ready ? previewUrl : buildProspect.preview_url,
      preview_expires_at: null,
      checkout_url: checkoutUrl || null,
      siteforge_qc_passed: ready,
      siteforge_visual_qc_passed: Boolean(dispatch.buildStatus?.visual_qc_passed),
      siteforge_qc_contract: dispatch.buildStatus?.qc_contract || null,
      siteforge_renderer: dispatch.buildStatus?.renderer || null,
      siteforge_generation_fingerprint: dispatch.buildStatus?.generation_fingerprint || null,
      release_evidence: releaseEvidence,
      siteforge_callback: {
        ...priorSiteForgeCallback,
        release_evidence: releaseEvidence,
      },
    },
  };
}

async function emailLogExists(prospect = {}) {
  const id = prospectId(prospect);
  const email = emailOf(prospect);
  // Fail CLOSED on a genuine read error: if we cannot verify de-dup state we
  // must assume the prospect may already have been emailed, or we risk a
  // duplicate cold send. A dry-run (no DB configured) is NOT an error — it has
  // no real send to protect — so it falls through to the normal exists:false.
  const unavailable = (r) => r && r.ok === false && r.mode !== "dry_run";
  // Suppression is newer, stronger truth than send history. Check it first so
  // an owner-proof replay may ignore a historic log without accidentally
  // ignoring a STOP/unsubscribe recorded after that send.
  if (email || id) {
    const suppressionClauses = [];
    if (email) suppressionClauses.push(`email.eq.${encodeURIComponent(email)}`);
    if (id) suppressionClauses.push(`prospect_id.eq.${encodeURIComponent(id)}`);
    const suppression = await select(
      "ghost_agency_suppressions",
      `?select=suppression_key,email,prospect_id&or=(${suppressionClauses.join(",")})&limit=1`,
    );
    if (unavailable(suppression)) return { exists: true, reason: "dedup_check_unavailable" };
    if (suppression.ok && Array.isArray(suppression.data) && suppression.data.length) {
      return { exists: true, reason: "suppressed" };
    }
  }
  const log = await select(
    "ghost_agency_email_log",
    // payload is selected so owner-proof rows can be told apart below: a proof
    // delivered to the OPERATOR is not a contact with the business, so it must
    // not dedup-block a real send (lib/email.js marks those rows since
    // durable owner-proof accounting landed — see isOwnerProofEmailRecord).
    `?select=prospect_id,sequence,step,suppressed,payload&prospect_id=eq.${encodeURIComponent(id)}&suppressed=eq.false&order=sent_at.asc&limit=20`,
  );
  if (unavailable(log)) return { exists: true, reason: "dedup_check_unavailable" };
  if (log.ok && Array.isArray(log.data) && log.data.some((row) => !isOwnerProofEmailRecord(row))) {
    return { exists: true, reason: "email_log_prospect" };
  }
  if (email) {
    const hash = emailHash(email);
    const emailLog = await select(
      "ghost_agency_email_log",
      "?select=prospect_id,sequence,step,suppressed,payload&suppressed=eq.false&order=sent_at.desc&limit=1000",
    );
    if (unavailable(emailLog)) return { exists: true, reason: "dedup_check_unavailable" };
    if (emailLog.ok && Array.isArray(emailLog.data) && emailLog.data.some((row) => (
      !isOwnerProofEmailRecord(row) && row.payload?.email_hash === hash
    ))) {
      return { exists: true, reason: "email_log_email" };
    }
  }
  return { exists: false };
}

function prospectSummary(prospect = {}) {
  const truth = prospect.truth_packet && typeof prospect.truth_packet === "object" ? prospect.truth_packet : {};
  const localPlan = truth.localSearchPlan || truth.local_search_plan || {};
  return {
    prospect_id: prospectId(prospect),
    business_name: firstValue(prospect, ["business_name", "businessName", "name", "company"], ""),
    email: emailOf(prospect) ? `${emailOf(prospect).slice(0, 3)}***` : "",
    score: Number(prospect.leadminer_score || prospect.score || 0),
    lane: prospect.contact_lane || prospect.record?.contact_lane || "",
    hasEmail: Boolean(emailOf(prospect)),
    hasBuildUrls: hasBuildUrls(prospect),
    opportunity: prospect.opportunity || prospect.record?.opportunity || null,
    localPlan: {
      status: localPlan.status || "candidate_only",
      targetTerms: (localPlan.targetTerms || localPlan.target_terms || []).slice(0, 6).map((item) => item.term || item),
      servicePages: localPlan.contentPlan?.servicePages || localPlan.content_plan?.service_pages || 4,
      serviceAreaPages: localPlan.contentPlan?.serviceAreaPages || localPlan.content_plan?.service_area_pages || 1,
    },
  };
}

function prospectPrivateSummary(prospect = {}) {
  return {
    ...prospectSummary(prospect),
    email: emailOf(prospect),
    phone: firstValue(prospect, ["phone", "phoneNumber"]),
    address: firstValue(prospect, ["address", "formattedAddress"]),
    city: firstValue(prospect, ["city", "market"]),
    state: firstValue(prospect, ["state", "region"]),
    industry: firstValue(prospect, ["industry", "category", "primary_type"], "local service"),
    current_website: firstValue(prospect, ["current_website", "currentWebsite", "website", "url"]),
    place_id: firstValue(prospect, ["place_id", "placeId"]),
    latlng: prospect.latlng || null,
    services: Array.isArray(prospect.services) ? prospect.services : [],
    truth_packet: prospect.truth_packet && typeof prospect.truth_packet === "object" ? prospect.truth_packet : null,
  };
}

function requestedProspectIds(input = {}, maxCount = 100, count = maxCount) {
  if (!Object.prototype.hasOwnProperty.call(input, "prospectIds")) return { ids: null };
  if (!Array.isArray(input.prospectIds) || !input.prospectIds.length) return { error: "prospect_ids_required" };
  if (input.prospectIds.length > maxCount || input.prospectIds.length > count) {
    return { error: "prospect_ids_exceed_requested_bound", max: Math.min(maxCount, count) };
  }
  const ids = input.prospectIds.map((value) => typeof value === "string" ? value.trim() : "");
  if (ids.some((id) => !id || id.length > 200)) return { error: "prospect_ids_must_be_non_empty_strings" };
  if (ids.some((id) => !/^[A-Za-z0-9._:-]+$/.test(id))) {
    return { error: "prospect_ids_have_invalid_characters" };
  }
  if (new Set(ids).size !== ids.length) return { error: "prospect_ids_must_be_unique" };
  return { ids };
}

function persistedProspectQuery(ids = []) {
  return `?select=*&prospect_id=in.(${ids.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",")})&limit=${ids.length}`;
}

async function loadPersistedProspects(ids = [], selectFn = select) {
  const result = await selectFn("ghost_agency_prospects", persistedProspectQuery(ids));
  if (!result || result.ok !== true || !Array.isArray(result.data)) return { ok: false, blocked: "prospect_store_read_failed" };
  const byId = new Map();
  for (const row of result.data) {
    const prospect = prospectFromRow(row);
    const id = prospect && prospectId(prospect);
    if (id) byId.set(id, prospect);
  }
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) return { ok: false, blocked: "prospect_ids_not_found", missing };
  // PostgREST does not guarantee IN-list ordering. Restore the explicit order.
  return { ok: true, prospects: ids.map((id) => byId.get(id)) };
}

async function runFullSystem(input = {}) {
  const runId = requestedRunId(input.runId);
  const dryRun = input.dryRun !== false;
  const test = isObject(input._test) ? input._test : {};
  const testHook = (name, fallback) => typeof test[name] === "function" ? test[name] : fallback;
  // Sandbox mode: build/score/site-gen run for real, but every SEND is routed to
  // the owner. Fail closed if the owner address is not configured.
  const sandboxMode = input.sandboxMode === true;
  const sandboxOwner = sandboxMode ? testHook("ownerSandboxAddress", ownerSandboxAddress)() : "";
  const ownerProofResend = input.ownerProofResend === true;
  if (ownerProofResend && !sandboxMode) {
    return { ok: false, runId, dryRun, blocked: "owner_proof_resend_requires_sandbox", message: "ownerProofResend is only allowed for an owner-only sandbox run. Nothing was sent." };
  }
  if (sandboxMode && !sandboxOwner) {
    return {
      ok: false,
      error: "sandbox_owner_email_unconfigured",
      message: "Sandbox mode requires GHOST_AGENCY_OWNER_EMAIL. Nothing was sent.",
      runId,
    };
  }
  const category = cleanCategory(input.category || input.industry);
  const location = cleanLocation(input.location || input.metro);
  const maxCount = clampNumber(process.env.GHOST_AGENCY_FULLRUN_MAX, 100, 1, 500);
  const count = clampNumber(input.count, 100, 1, maxCount);
  const requestedIds = requestedProspectIds(input, maxCount, count);
  if (requestedIds.error) {
    return { ok: false, runId, dryRun, blocked: requestedIds.error, maxProspectIds: requestedIds.max, message: "Explicit prospectIds must be unique non-empty strings within the requested batch bound. Nothing ran." };
  }
  const persistedProspectMode = Array.isArray(requestedIds.ids);
  const ownerProofMode = persistedProspectMode && sandboxMode && ownerProofResend;
  const sendLimit = input.sendLimit == null ? null : clampNumber(input.sendLimit, count, 1, maxCount);
  const configuredRawMax = clampNumber(process.env.GHOST_AGENCY_FULLRUN_RAW_LIMIT, 1000, count, 1000);
  const rawLimit = clampNumber(
    input.rawLimit,
    dryRun ? Math.min(configuredRawMax, Math.max(20, count * 10)) : configuredRawMax,
    count,
    configuredRawMax,
  );
  const started = Date.now();
  const suppliedOwnerDeadlineAt = Number(input.ownerProofDeadlineAt);
  const fallbackOwnerDeadlineAt = started + OWNER_PROOF_REQUEST_WINDOW_MS;
  const ownerProofRequestDeadlineAt = ownerProofMode
    ? Math.min(
        fallbackOwnerDeadlineAt,
        Number.isFinite(suppliedOwnerDeadlineAt) && suppliedOwnerDeadlineAt > 0
          ? suppliedOwnerDeadlineAt
          : fallbackOwnerDeadlineAt,
      )
    : 0;
  const ownerProofBuildDeadlineAt = ownerProofMode
    ? ownerProofRequestDeadlineAt - OWNER_PROOF_FINALIZE_RESERVE_MS
    : 0;
  const writeProgress = (stage, payload = {}) => ownerProofMode
    ? boundedOwnerProofWork(
        () => testHook("progress", progress)(runId, stage, payload),
        ownerProofRequestDeadlineAt,
      )
    : testHook("progress", progress)(runId, stage, payload);

  if (ownerProofMode && ownerProofBuildDeadlineAt - Date.now() <= OWNER_PROOF_SEND_START_MIN_MS) {
    return {
      ok: false,
      runId,
      dryRun,
      sandboxMode,
      blocked: "owner_proof_build_deadline_exhausted",
      message: "The owner-proof build budget expired before durable work could start. Nothing was built or sent.",
    };
  }

  if (!persistedProspectMode && (!category || !location)) {
    await writeProgress("refused", {
      status: "blocked",
      reason: "mine_plan_incomplete",
      requestedCategory: input.category || input.industry || null,
      requestedLocation: input.location || input.metro || null,
    });
    return {
      ok: false,
      runId,
      dryRun,
      blocked: "mine_plan_incomplete",
      message: "An approved category and explicit city/location are required. Nothing ran.",
    };
  }

  if (!dryRun && !(persistedProspectMode && sandboxMode)) {
    const sender = outreachFromStatus();
    if (!sender.ok) {
      await writeProgress("blocked", {
        status: "blocked",
        category,
        location,
        count,
        reason: sender.reason,
      });
      return {
        ok: false,
        runId,
        dryRun,
        blocked: "outreach_sender_not_ready",
        sender,
        message: "Live full-run requires GHOST_AGENCY_OUTREACH_FROM on go.wss-ai.com before any cold send.",
      };
    }
  }

  await writeProgress("started", {
    category,
    location,
    count,
    dryRun,
    rawLimit,
    sandboxMode,
    ownerProofResend,
    mode: ownerProofMode ? "owner-five" : "autopilot",
  });
  if (ownerProofMode && ownerProofBuildDeadlineAt - Date.now() <= OWNER_PROOF_SEND_START_MIN_MS) {
    return {
      ok: false,
      runId,
      dryRun,
      sandboxMode,
      blocked: "owner_proof_build_deadline_exhausted",
      message: "The owner-proof build budget expired before the selected prospects could be loaded. Nothing was built or sent.",
    };
  }
  // Explicit persisted IDs are an owner-selected batch, never a mining query.
  // Resolve their durable records once and preserve the caller's ordering.
  const mined = persistedProspectMode
    ? await loadPersistedProspects(requestedIds.ids, testHook("select", select)).then((loaded) => ({
      ok: loaded.ok,
      mode: "persisted_batch",
      records: loaded.prospects || [],
      found: loaded.prospects?.length || 0,
      withEmail: (loaded.prospects || []).filter((prospect) => Boolean(emailOf(prospect))).length,
      message: loaded.blocked,
      detail: loaded.missing,
    }))
    : await testHook("mineLeads", mineLeads)({
      industry: category,
      location,
      limit: rawLimit,
      selectCount: count,
      includeRecords: true,
      persist: !dryRun,
      logEvent: true,
      enrichLimit: dryRun ? Math.min(rawLimit, 60) : rawLimit,
      actor: "agent_01_prospect_miner",
      trigger: "full_run",
    });

  if (ownerProofMode && ownerProofBuildDeadlineAt - Date.now() <= OWNER_PROOF_SEND_START_MIN_MS) {
    return {
      ok: false,
      runId,
      dryRun,
      sandboxMode,
      blocked: "owner_proof_build_deadline_exhausted",
      message: "The owner-proof build budget expired while loading the selected prospects. Nothing was built or sent.",
    };
  }

  await writeProgress("mined", {
    category,
    location,
    dryRun,
    ok: mined.ok,
    found: mined.found || 0,
    withEmail: mined.withEmail || 0,
    deduped: mined.deduped || 0,
    mode: mined.mode,
  });

  if (!mined.ok) {
    await writeProgress("failed", {
      status: "failed",
      category,
      location,
      reason: mined.mode,
      detail: mined.message,
    });
    return {
      ok: false,
      runId,
      dryRun,
      stage: "mined",
      error: mined.mode,
      message: mined.message,
      detail: mined.detail,
    };
  }

  const records = Array.isArray(mined.records) ? mined.records : [];
  let canonicalGuardMode = persistedProspectMode;
  let selected;
  if (!persistedProspectMode && !dryRun) {
    // A normal live mine may merge an incoming place into a different durable
    // canonical prospect ID. Never packet/send the incoming snapshot. Require
    // a proven persistence pass, take the canonical IDs returned by LeadMiner,
    // and exact-load those rows before any consent work.
    const summaries = (Array.isArray(mined.rows) ? mined.rows : []).filter((row) => new Set([
      "created",
      "updated",
      "duplicate_skipped",
      "concurrent_duplicate_skipped",
    ]).has(String(row?.persistence || "").trim().toLowerCase()));
    const selectedSummaries = summaries.filter((row) => row?.selected).slice(0, count);
    const chosenSummaries = selectedSummaries.length ? selectedSummaries : summaries.slice(0, count);
    const canonicalIds = [...new Set(chosenSummaries.map((row) => String(row?.prospect_id || "").trim()).filter(Boolean))];
    if (mined.persisted !== true || !canonicalIds.length) {
      await writeProgress("failed", {
        status: "failed",
        category,
        location,
        reason: "canonical_mining_persistence_unproven",
      });
      return {
        ok: false,
        runId,
        dryRun,
        stage: "mined",
        blocked: "canonical_mining_persistence_unproven",
        message: "Live mined prospects were not durably reloaded, so nothing was packeted or sent.",
      };
    }
    const loaded = await loadPersistedProspects(canonicalIds, testHook("select", select));
    if (!loaded.ok) {
      return {
        ok: false,
        runId,
        dryRun,
        stage: "mined",
        blocked: loaded.blocked || "canonical_mining_reload_failed",
        detail: loaded.missing,
        message: "Canonical mined prospects could not be reloaded, so nothing was packeted or sent.",
      };
    }
    selected = loaded.prospects;
    canonicalGuardMode = true;
  } else {
    // Dry-run returns the RAW build-ready records (persist is off), which carry
    // business_name/email inside mirror_request.facts — invisible to
    // prospectFromRow, which reads the persisted-row shape. Map them through the
    // same row shape the live lane persists so the summary shows real names.
    const normalized = persistedProspectMode ? records : records.map((row) => rowFromBuildReady(row, null));
    const selectedRows = persistedProspectMode ? normalized : normalized.filter((row) => row._opportunitySelected).slice(0, count);
    selected = (persistedProspectMode ? selectedRows : (selectedRows.length ? selectedRows : normalized.slice(0, count)))
      .map((row) => prospectFromRow(row))
      .filter(Boolean);
  }
  // A placeholder email ("your@email.com") is uncontactable — it counts as NO
  // email here so it can never enter the send pool, exactly like a row with no
  // address at all. The miner already stops new ones at capture; this also keeps
  // any already-stored placeholder row out of the contactable set.
  const sendableEmailFor = (prospect) => { const e = emailOf(prospect); return e && !isPlaceholderEmail(e) ? e : ""; };
  const contactable = selected.filter((prospect) => Boolean(sendableEmailFor(prospect)));
  const noEmail = selected.filter((prospect) => !sendableEmailFor(prospect));

  await writeProgress("scored", {
    category,
    location,
    dryRun,
    scored: mined.scoredCount || records.length,
    eligible: mined.eligibleCount || selected.length,
    selected: selected.length,
    contactable: contactable.length,
    noEmail: noEmail.length,
  });

  if (dryRun) {
    await writeProgress("packeted", { category, location, dryRun, planned: selected.length, siteforgeDispatches: 0 });
    await writeProgress("queued", { category, location, dryRun, wouldQueue: contactable.length, callOrSms: noEmail.length });
    const wouldSend = sendLimit == null ? contactable.length : Math.min(contactable.length, sendLimit);
    await writeProgress("sent", { category, location, dryRun, wouldSend, sent: 0 });
    return {
      ok: true,
      runId,
      dryRun,
      category,
      location,
      count,
      rawLimit,
      plan: {
        found: mined.found || 0,
        deduped: mined.deduped || 0,
        scored: mined.scoredCount || records.length,
        eligible: mined.eligibleCount || selected.length,
        selected: selected.length,
        wouldPacket: selected.length,
        wouldBuild: 0,
        wouldCreateAutosendIntents: 0,
        wouldQueue: contactable.length,
        wouldSend,
        sendLimit,
        callOrSms: noEmail.length,
        localOptimization: {
          targetTermsPerBusiness: clampNumber(process.env.GHOST_AGENCY_LOCAL_PLAN_MAX_TERMS, 6, 1, 6),
          servicePagesMax: clampNumber(process.env.GHOST_AGENCY_LOCAL_PLAN_MAX_SERVICE_PAGES, 4, 1, 4),
          serviceAreaPagesMax: clampNumber(process.env.GHOST_AGENCY_LOCAL_PLAN_MAX_SERVICE_AREA_PAGES, 8, 1, 12),
          evidenceRule: "Measured rank and citation claims require verified local-market data; otherwise the plan remains candidate-only.",
        },
      },
      selected: selected.map(input.includePrivate ? prospectPrivateSummary : prospectSummary),
      note: "DRY RUN - mined and scored real Places data; SiteForge dispatch and autosend remain disabled until an explicit post-reply build.",
    };
  }

  // Consent-first pipeline: mine/enrich/packet every selected prospect, but do
  // not dispatch or publish SiteForge from a cold/full run. Explicit admin and
  // post-reply callers can still invoke buildPreviewForProspect directly.
  const packeted = [];
  const built = [];
  const packetWaveConfigured = process.env.GHOST_AGENCY_PACKET_WAVE === undefined || process.env.GHOST_AGENCY_PACKET_WAVE === ""
    ? Number(process.env.GHOST_AGENCY_DISPATCH_WAVE)
    : Number(process.env.GHOST_AGENCY_PACKET_WAVE);
  const PACKET_WAVE = Number.isFinite(packetWaveConfigured)
    ? (packetWaveConfigured === 0 ? 0 : Math.max(1, Math.min(50, packetWaveConfigured)))
    : 25;
  for (let waveStart = 0; PACKET_WAVE > 0 && waveStart < selected.length; waveStart += PACKET_WAVE) {
    if (ownerProofMode && ownerProofBuildDeadlineAt - Date.now() <= OWNER_PROOF_SEND_START_MIN_MS) {
      break;
    }
    const wave = selected.slice(waveStart, waveStart + PACKET_WAVE);
    const waveResults = await Promise.all(wave.map(async (prospect, waveIdx) => {
      const compositionSlot = waveStart + waveIdx;
      const item = await testHook("packetProspectForConsent", packetProspectForConsent)(prospect, {
        runId,
        source: "full_run_consent_first",
        compositionSlot,
        requireCanonicalGuard: canonicalGuardMode,
        select: testHook("select", select),
        conditionalUpdate: testHook("conditionalUpdate", conditionalUpdate),
      });
      await writeProgress("packeted", {
        category,
        location,
        prospectId: item.prospect_id,
        businessName: item.business_name,
        ready: item.ok === true,
        packeted: waveStart + waveIdx + 1,
        total: selected.length,
        blocked: item.blocked,
        siteforgeDispatched: false,
        autosendCreated: false,
      });
      return item;
    }));
    packeted.push(...waveResults);
  }

  const queueCandidates = [];
  const preQueueSkipped = [];
  for (const item of packeted) {
    const gate = consentFirstQueueGate(item);
    if (gate.ok) {
      queueCandidates.push({ ...item, sendProspect: gate.prospect });
    } else if (!item.ok) {
      preQueueSkipped.push({
        prospect_id: item.prospect_id,
        skipped: item.blocked || "consent_packet_failed",
      });
    }
  }
  const sendableAll = queueCandidates;
  const sendable = sendLimit == null ? sendableAll : sendableAll.slice(0, sendLimit);
  const packetFailed = packeted.filter((item) => !item.ok);
  await writeProgress("queued", {
    category,
    location,
    packeted: packeted.filter((item) => item.ok).length,
    failedPackets: packetFailed.length,
    siteforgeDispatches: 0,
    autosendIntentsCreated: 0,
    failedDeliveryGates: preQueueSkipped.length,
    queued: sendable.length,
    sendableBeforeLimit: sendableAll.length,
    callOrSms: noEmail.length,
  });

  const sent = [];
  const skipped = [...preQueueSkipped];
  const ownerProofDuplicateReasons = new Set(["email_log_prospect", "email_log_email"]);
  for (let sendIndex = 0; sendIndex < sendable.length; sendIndex += 1) {
    const item = sendable[sendIndex];
    if (ownerProofMode && ownerProofRequestDeadlineAt - Date.now() <= OWNER_PROOF_SEND_START_MIN_MS) {
      for (const remaining of sendable.slice(sendIndex)) {
        skipped.push({
          prospect_id: remaining.prospect_id,
          skipped: "owner_proof_deadline_exhausted",
        });
      }
      break;
    }
    let canonicalSendProspect = item.sendProspect;
    if (canonicalGuardMode) {
      const loaded = await loadPersistedProspects(
        [item.prospect_id],
        testHook("select", select),
      ).catch(() => ({ ok: false, blocked: "prospect_store_read_failed" }));
      const fresh = loaded.ok ? loaded.prospects?.[0] : null;
      if (!fresh) {
        skipped.push({
          prospect_id: item.prospect_id,
          skipped: loaded.blocked || "canonical_recipient_unavailable",
        });
        continue;
      }
      const verdict = canonicalConsentRecipient(fresh);
      if (!verdict.ok) {
        skipped.push({ prospect_id: item.prospect_id, skipped: verdict.reason });
        continue;
      }
      const preparedFingerprint = emailHash(emailOf(item.sendProspect));
      if (!preparedFingerprint || preparedFingerprint !== verdict.fingerprint) {
        skipped.push({ prospect_id: item.prospect_id, skipped: "canonical_recipient_changed" });
        continue;
      }
      canonicalSendProspect = consentFirstSendProspect(fresh);
    }

    const duplicate = await testHook("emailLogExists", emailLogExists)(canonicalSendProspect);
    // Owner proof may replay a historic send to the owner, but STOP,
    // suppression, and an unavailable de-dup read remain absolute holds.
    const ownerProofMayReplay = ownerProofMode && ownerProofDuplicateReasons.has(duplicate.reason);
    if (duplicate.exists && !ownerProofMayReplay) {
      skipped.push({ prospect_id: item.prospect_id, skipped: duplicate.reason });
      continue;
    }

    // Re-read after the network-backed de-dup/suppression check. This is the
    // final await before entering the sender, so a STOP, closed_lost, held
    // status, suppression, or recipient change that landed during de-dup wins.
    if (canonicalGuardMode) {
      const loaded = await loadPersistedProspects(
        [item.prospect_id],
        testHook("select", select),
      ).catch(() => ({ ok: false, blocked: "prospect_store_read_failed" }));
      const fresh = loaded.ok ? loaded.prospects?.[0] : null;
      if (!fresh) {
        skipped.push({
          prospect_id: item.prospect_id,
          skipped: loaded.blocked || "canonical_recipient_unavailable",
        });
        continue;
      }
      const verdict = canonicalConsentRecipient(fresh);
      const preparedFingerprint = emailHash(emailOf(item.sendProspect));
      if (!verdict.ok || !preparedFingerprint || preparedFingerprint !== verdict.fingerprint) {
        skipped.push({
          prospect_id: item.prospect_id,
          skipped: verdict.ok ? "canonical_recipient_changed" : verdict.reason,
        });
        continue;
      }
      canonicalSendProspect = consentFirstSendProspect(fresh);
    }

    // De-dup was evaluated above on the real prospect (emailLogExists). Only
    // now, at the send step, do we redirect the recipient to the owner for
    // sandbox runs — identity/prospect_id are preserved so each business still
    // yields exactly one email, all delivered to the owner.
    // Only the consent offer is eligible here. Prebuilt URLs and renderer state
    // were stripped before this point and are never passed as template vars.
    const sourceRecipientEmail = emailOf(canonicalSendProspect);
    let sendProspect = canonicalSendProspect;
    if (sandboxMode) {
      sendProspect = forceOwnerRecipient(sendProspect, sandboxOwner);
      // Keep the persisted nested record aligned with the envelope. Some
      // renderers and compliance helpers read record.email rather than the
      // top-level recipient fields; no real prospect address may survive an
      // owner-only proof handoff.
      if (isObject(sendProspect.record)) {
        sendProspect.record = {
          ...sendProspect.record,
          email: sandboxOwner,
          ownerEmail: sandboxOwner,
          owner_email: sandboxOwner,
        };
      }
      if (!assertOwnerOnly(sendProspect, sandboxOwner)) {
        skipped.push({ prospect_id: item.prospect_id, skipped: "sandbox_recipient_gate_failed" });
        continue;
      }
    }
    const result = await testHook("sendSequenceStep", sendSequenceStep)({
      prospect: sendProspect,
      sequence: 1,
      step: 1,
      dryRun: false,
      // A sandbox run IS an internal owner proof: forceOwnerRecipient +
      // assertOwnerOnly above have already pinned the recipient to the owner's
      // own address and bailed out fail-closed if that did not hold. Say so, or
      // the review/delivery/contact holds block every send after the packet is
      // prepared. Each bypass in email.js independently re-checks
      // `to === GHOST_AGENCY_OWNER_EMAIL`, so this can never reach a prospect:
      // it only ever unblocks mail addressed to the owner.
      internalOwnerProof: sandboxMode,
      sourceRecipientEmail,
      requireCanonicalRecipientGuard: canonicalGuardMode,
      deadlineAt: ownerProofMode ? ownerProofRequestDeadlineAt : 0,
      allowReviewHoldBypass: sandboxMode,
      allowDeliveryPauseBypass: sandboxMode,
      allowContactHoldBypass: sandboxMode,
      persistCampaignLog: !ownerProofMode,
      vars: {
        run_id: runId,
        consent_first: true,
        keyword_1: `${sendProspect.services?.[0] || sendProspect.industry || category} ${sendProspect.city || location}`.trim(),
      },
    });
    if (result.ok) sent.push({ prospect_id: item.prospect_id, mode: result.mode, id: result.id });
    else skipped.push({ prospect_id: item.prospect_id, skipped: result.blocked || result.error || "send_failed" });
  }

  await writeProgress("sent", {
    category,
    location,
    dryRun,
    sandboxMode,
    queued: sendable.length,
    sent: sent.length,
    sentProspectIds: sent.map((item) => item.prospect_id).filter(Boolean),
    skipped: skipped.length,
    skippedReasons: sanitizedSkipReasons(skipped),
    durationMs: Date.now() - started,
  });

  return {
    ok: true,
    runId,
    dryRun,
    sandboxMode,
    sandboxRecipient: sandboxMode ? sandboxOwner : undefined,
    category,
    location,
    count,
    rawLimit,
    mined: {
      found: mined.found || 0,
      deduped: mined.deduped || 0,
      withEmail: mined.withEmail || 0,
    },
    scored: {
      scored: mined.scoredCount || records.length,
      eligible: mined.eligibleCount || selected.length,
      selected: selected.length,
      contactable: contactable.length,
      callOrSms: noEmail.length,
    },
    packeted,
    built,
    queued: sendable.length,
    sendLimit,
    sendableBeforeLimit: sendableAll.length,
    sent,
    skipped,
    durationMs: Date.now() - started,
  };
}

module.exports = {
  blockedLeadMinerMirrorDispatch,
  // Exported so the "a refusal must name its cause" contract is testable
  // without standing up a whole build.
  causeOfEachFailure,
  // The `name=status` bracket itself, with each failing check's own
  // diagnostic appended — the string the operator's dead row carries.
  failingGateSummary,
  buildPreviewForProspect,
  dispatchMirrorLane,
  enqueueHeroRemasterForBuild,
  completedOwnedHeroBank,
  // Exported for the pre-build hook's tests; production reaches them only
  // through dispatchMirrorLane behind GHOST_AGENCY_HERO_REEL_PREBUILD.
  heroReelPrebuildEnabled,
  heroRemasterEnabled,
  heroRemasterEnqueueTimeoutMs,
  recordWithPreBuiltHeroReel,
  isCompleteLeadMinerMirrorReadyPacket,
  isLeadMinerMirrorReadyPacket,
  legacySiteForgePendingResume,
  mirrorLaneEnabled,
  consentFirstSendProspect,
  emailLogExists,
  packetProspectForConsent,
  progress,
  // Exported for the test that locks the mined logo into the dashboard build
  // input; nothing in production imports it.
  prospectBuildInput,
  runFullSystem,
  truthPacketWithLocalPlan,
};
