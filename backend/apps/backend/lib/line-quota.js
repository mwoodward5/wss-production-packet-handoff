"use strict";

const { createHash } = require("node:crypto");
const { buildableVerticals } = require("./buildable-verticals");
const heroBudget = require("./line-hero-budget");
const lineState = require("./line-state");
const { REGION_TOKENS, ZIP_MARKETS } = require("./market-tokens");

const QUOTA_CONTRACT_STAGE = "quota_contract_finished_sites_v1";
const QUOTA_SOURCE_PREFIX = "quota_source_";
const DEFAULT_SOURCE_CHUNK = 10;
const GAPLESS_LINE_ENV = "GHOST_AGENCY_LINE_GAPLESS";

// LINE DEEP BATCH DEPTH (owner doctrine 2026-09-04, "scaling and rapid
// production flow"). The quota used to clip every source attempt to the
// goal-sized cohort: `candidatesPerQuery` never exceeded the remaining quota,
// so of ~40 email-surviving discovery candidates only the first 10 were ever
// deep-verified. This dial raises the deep-verification wave: when the
// environment sets LINE_DEEP_BATCH_DEPTH to an integer >= 1 (e.g. 40), the
// source attempt grades the wider cohort in one wave and the count
// truncation + prospect-bank surplus deposit seat the goal and bank the rest.
// Unset, blank, non-numeric, or < 1 keeps the historical goal-sized cohort
// exactly. A campaign can also request it on the start path: the minted
// batch's quota-contract row carries `deep_batch_depth`, which wins over the
// environment so a campaign started under one setting keeps its wave size on
// every refill. 100 is the provider SERP width — discovery cannot surface
// more survivors in one wave than the search can name.
const DEEP_BATCH_DEPTH_ENV = "LINE_DEEP_BATCH_DEPTH";
const DEEP_BATCH_DEPTH_CEILING = 100;
function requestedDeepBatchDepth(environment = process.env) {
  const raw = Number(String((environment && environment[DEEP_BATCH_DEPTH_ENV]) ?? "").trim());
  if (!Number.isInteger(raw) || raw < 1) return null;
  return Math.min(raw, DEEP_BATCH_DEPTH_CEILING);
}
function deepBatchDepthForBatch(batch, environment = process.env) {
  const stamped = funnelRows(batch && batch.mineFunnel)
    .map((row) => (String(row.stage || "") === QUOTA_CONTRACT_STAGE ? Number(row.deep_batch_depth) : NaN))
    .find((value) => Number.isInteger(value) && value >= 1);
  return Number.isInteger(stamped)
    ? Math.min(stamped, DEEP_BATCH_DEPTH_CEILING)
    : requestedDeepBatchDepth(environment);
}

// LINE RESUME CAP (zone-flood campaigns, 2026-09-03). The accepted-checkpoint
// resume payload — `pick_accepted_rows` on the durable start watch — used to
// hard-cap at 10 rows, written when the checkpoint only ever had to cover a
// goal-sized cohort. Zone-flood campaigns now run deep batches
// (LINE_DEEP_BATCH_DEPTH, PR #691), so one pick can accept far more than 10
// durable rows before the response/checkpoint boundary; a crash there dropped
// every accepted row past the first 10 from the checkpoint and the resume
// could not reconcile them without paying the provider twice. This dial widens
// the checkpoint payload: it caps accepted rows at LINE_RESUME_CAP when the
// environment sets an integer >= 1, defaulting to 50 (a full flood wave)
// when unset, blank, non-numeric, or < 1. 100 is the ceiling for the same
// reason as the depth dial — the provider SERP width — so anything beyond it
// is a typo, not a dial.
const RESUME_CAP_ENV = "LINE_RESUME_CAP";
const RESUME_CAP_DEFAULT = 50;
const RESUME_CAP_CEILING = 100;
function lineResumeCap(environment = process.env) {
  const raw = Number(String((environment && environment[RESUME_CAP_ENV]) ?? "").trim());
  if (!Number.isInteger(raw) || raw < 1) return RESUME_CAP_DEFAULT;
  return Math.min(raw, RESUME_CAP_CEILING);
}

// TARGET MAX POLISH (owner directive 2026-09-03, the #689 targeting-tighten).
// PR #694 ranks thin/un-integrated sites first, but ranking only ORDERS: when
// a market's thin pool exhausts (Austin after three smoke runs), the goal-
// sized pool still admitted LOA-class heavyweights to fill the requested
// count — exactly the site class the owner rejected ("not a good site for
// rebuilding — too heavy of a site"). This dial is the ADMISSION CEILING on
// original-site polish: a candidate whose measured homepage polish (100
// minus the #694 integration-gap score) exceeds the ceiling is skipped with
// a recorded reason (`target_too_polished:skip` on the 2_homepage_fetch
// funnel stage) instead of being built. The zone-flood "record never refuse"
// law governs OUR build quality ceilings; target selection MAY skip with a
// recorded reason. An all-heavy window therefore UNDER-FILLS (fewer rows,
// honest halt/wait-for-refill) — the owner's explicit preference over
// force-filling. Default 75: the rejected LOA-class roofing site measured
// polish 100 (a modern-premium heavyweight caps at 90), a basic un-integrated
// contractor site measures 15-30, and the admitted boundary (65) is a site
// with at most two of the four headline integrations. Unset, blank or
// non-numeric keeps the default; a literal 0 disables the ceiling (pure
// #694 ranking, nobody skipped) so volume-over-targeting stays one env away.
// 100 is the scale ceiling — anything beyond it is a typo, not a dial.
const TARGET_MAX_POLISH_ENV = "TARGET_MAX_POLISH";
const TARGET_MAX_POLISH_DEFAULT = 75;
const TARGET_MAX_POLISH_CEILING = 100;
function targetMaxPolish(environment = process.env) {
  const raw = String((environment && environment[TARGET_MAX_POLISH_ENV]) ?? "").trim();
  if (raw === "") return TARGET_MAX_POLISH_DEFAULT;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return TARGET_MAX_POLISH_DEFAULT;
  return Math.min(Math.trunc(value), TARGET_MAX_POLISH_CEILING);
}

// Automatic All Trades is a service-template campaign, not a sweep of every
// buildable donor. Keep this list deliberate and stable: adding a donor does
// not silently make it eligible for nationwide cold outreach. Real estate is
// still buildable when explicitly requested, while salon and tattoo remain
// explicit members of the automatic service rotation.
const ALL_TRADES_VERTICAL_ORDER = Object.freeze([
  "plumbing",
  "hvac",
  "fencing",
  "concrete",
  "electrical",
  "general contractor",
  "landscaping",
  "roofing",
  "med spa",
  "salon",
  "tattoo",
]);

// The donor registry calls this vertical "salon", while the miner's frozen
// category contract calls it "hair salon". Keep quota balancing on the donor
// identity and translate only the outbound fresh-miner assignment.
const ALL_TRADES_MINER_CATEGORY = Object.freeze({
  salon: "hair salon",
});

const NATIONWIDE_METROS = Object.freeze([
  "Houston TX", "Dallas TX", "San Antonio TX", "Austin TX", "Fort Worth TX",
  "Oklahoma City OK", "Tulsa OK", "Phoenix AZ", "Tucson AZ", "Albuquerque NM",
  "Denver CO", "Colorado Springs CO", "Kansas City MO", "St Louis MO", "Omaha NE",
  "Wichita KS", "Little Rock AR", "Memphis TN", "Nashville TN", "Knoxville TN",
  "Louisville KY", "Birmingham AL", "Jackson MS", "Baton Rouge LA", "Shreveport LA",
  "Atlanta GA", "Charlotte NC", "Columbia SC", "Charleston SC", "Jacksonville FL",
  "Tampa FL", "Orlando FL", "Boise ID", "Salt Lake City UT", "Las Vegas NV",
  "Reno NV", "Fresno CA", "Sacramento CA", "Spokane WA", "Portland OR",
  "Des Moines IA", "Indianapolis IN", "Columbus OH", "Cincinnati OH",
]);

// QUERY-SHAPE DIVERSITY (owner directive 2026-09-01). One ladder shape per
// source attempt: metro -> region -> zip -> metro... A retry that only
// advanced the metro ladder re-read a SERP of the same grammatical form and
// kept meeting the same directory-heavy winners; a region token ("plumbing in
// West Texas") or a ZIP token ("plumbing in 79401") surfaces a genuinely
// different result page. Rotation is deterministic: the shape is a pure
// function of the attempt number, and each ladder starts at a batch-stable
// offset (campaignSourceOffset) exactly like the existing metro/vertical
// offsets, so two campaigns never clone one another's search order.
const QUERY_SHAPE_CYCLE = Object.freeze(["metro", "region", "zip"]);

function queryShapeForAttempt(attempt) {
  return QUERY_SHAPE_CYCLE[Math.max(0, Number(attempt) || 0) % QUERY_SHAPE_CYCLE.length];
}

function regionTokenForAttempt(batchId, attempt) {
  const tokens = REGION_TOKENS.map((entry) => entry.token);
  const offset = campaignSourceOffset(batchId, "region", tokens.length);
  return tokens[(offset + Math.max(0, Number(attempt) || 0)) % tokens.length];
}

function zipTokenForAttempt(batchId, attempt) {
  const codes = ZIP_MARKETS.map((entry) => entry.zip);
  const offset = campaignSourceOffset(batchId, "zip", codes.length);
  return codes[(offset + Math.max(0, Number(attempt) || 0)) % codes.length];
}

/** The market place a fresh source attempt should search, per rotated shape. */
function freshSourcePlace(batchId, attempt, metros) {
  const shape = queryShapeForAttempt(attempt);
  if (shape === "region") return { shape, place: regionTokenForAttempt(batchId, attempt) };
  if (shape === "zip") return { shape, place: zipTokenForAttempt(batchId, attempt) };
  const ladder = Array.isArray(metros) && metros.length ? metros : NATIONWIDE_METROS;
  return { shape, place: ladder[Math.max(0, Number(attempt) || 0) % ladder.length] };
}

function funnelRows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
}
function finishedQuotaEnabled(batch) {
  return funnelRows(batch && batch.mineFunnel).some((row) => String(row.stage || "") === QUOTA_CONTRACT_STAGE);
}
function finishedRows(batch) {
  return (batch && Array.isArray(batch.rows) ? batch.rows : []).filter((row) => row
    && (row.status === "queued"
      || row.status === "sent"
      || (row.status === "ready" && !lineState.strandedReadyRow(row))));
}
function activeRows(batch) {
  const active = new Set(["picked", "qualified", "mirrored", "gate_passed"]);
  return (batch && Array.isArray(batch.rows) ? batch.rows : []).filter((row) => row
    && (active.has(String(row.status || "")) || lineState.strandedReadyRow(row)));
}
function remainingFinishedQuota(batch) {
  const requested = Math.max(0, Number(batch && batch.requested) || 0);
  return Math.max(0, requested - finishedRows(batch).length);
}
function replacementDeficit(batch) {
  const requested = Math.max(0, Number(batch && batch.requested) || 0);
  return Math.max(0, requested - finishedRows(batch).length - activeRows(batch).length);
}
function heroCandidateBudgetLimit(batch) {
  return Math.max(0, Number(batch && batch.requested) || 0);
}
function checkpointedHeroCandidateRows(batch) {
  return heroBudget.checkpointedRows(batch);
}
function reservedHeroCandidateRows(batch) {
  return heroBudget.budgetConsumedRows(batch);
}
function invalidReservedHeroCandidateRows(batch) {
  return heroBudget.invalidCheckpointRows(batch);
}
function activeUncheckpointedHeroCandidateRows(batch) {
  const reserved = new Set(reservedHeroCandidateRows(batch));
  return activeRows(batch).filter((row) => !reserved.has(row));
}
function remainingHeroCandidateBudget(batch) {
  return heroBudget.remaining(batch, heroCandidateBudgetLimit(batch));
}
function heroAutolineEnabled(environment = process.env) {
  return ![
    environment?.GHOST_AGENCY_HERO_AUTOLINE,
    environment?.GHOST_AGENCY_HERO_REMMASTER,
    environment?.GHOST_AGENCY_HERO_REMASTER,
  ].some((value) => /^(0|false|off|no)$/i.test(String(value ?? "").trim()));
}
function ownerOnlyNoVideoQuota(batch, environment = process.env) {
  return String(batch?.lane || "") === "sandbox" && !heroAutolineEnabled(environment);
}
function remainingHeroCandidateSourceBudget(batch, environment = process.env) {
  // Practice proof runs with video explicitly disabled do not have a paid hero
  // candidate ceiling to protect. Keep the ceiling unchanged for Live and for
  // every run where hero generation is enabled.
  if (ownerOnlyNoVideoQuota(batch, environment)) return replacementDeficit(batch);
  // Picked rows have not reached the durable qualification checkpoint yet, but
  // every one of them can still consume a paid-candidate slot. Reserve those
  // potential slots before gapless refill. Without this subtraction a batch of
  // three with one terminal checkpoint plus one active picked row could source
  // two replacements and later commit four checkpoints.
  return Math.max(
    0,
    remainingHeroCandidateBudget(batch) - activeUncheckpointedHeroCandidateRows(batch).length,
  );
}
function heroPaidCandidateBudgetExhausted(batch) {
  return heroCandidateBudgetLimit(batch) > 0 && remainingHeroCandidateBudget(batch) === 0;
}
function heroPaidCandidateBudgetBlocksCompletion(batch, environment = process.env) {
  if (ownerOnlyNoVideoQuota(batch, environment)) return false;
  return finishedQuotaEnabled(batch)
    && remainingFinishedQuota(batch) > 0
    && activeRows(batch).length === 0
    && heroPaidCandidateBudgetExhausted(batch);
}
function gaplessLineEnabled(environment = process.env) {
  return String(environment && environment[GAPLESS_LINE_ENV] !== undefined
    ? environment[GAPLESS_LINE_ENV]
    : "1").trim() !== "0";
}
function sourceDeficit(batch, environment = process.env) {
  return Math.min(replacementDeficit(batch), remainingHeroCandidateSourceBudget(batch, environment));
}
// THE MONEY STOP. Mine only the true replacement deficit: requested minus both
// finished and still-active rows. Failed rows get replacements without waiting
// for unrelated active work, while active rows are never double-counted. The
// finite attempt cap still stops an unbounded miner/build/deploy loop when
// supply or rendering is structurally unavailable.
const MAX_REFILL_ATTEMPTS = 12;
function shouldRefill(batch, environment = process.env) {
  if (String(batch && batch.status || "") === "halted") return false;
  if (terminalSourceExhausted(batch)) return false;
  const gapless = gaplessLineEnabled(environment);
  return finishedQuotaEnabled(batch) && sourceDeficit(batch, environment) > 0
    && (gapless || activeRows(batch).length === 0)
    && sourceAttempt(batch && batch.mineFunnel) <= MAX_REFILL_ATTEMPTS
    && !["halted", "approved", "sending"].includes(String(batch && batch.status || ""));
}
function sourceAttempt(mineFunnel) {
  // mineFunnel is intentionally bounded to its newest ~80 diagnostic rows.
  // Counting source markers therefore plateaus once old markers roll off — in
  // production it froze at attempt 9 and re-mined Tattoo/Tucson forever. The
  // attempt number is already encoded in every marker; advance from the largest
  // one still present instead of counting the rolling window.
  const attempts = funnelRows(mineFunnel).flatMap((row) => {
    const match = String(row.stage || "").match(/^quota_source_(\d+)(?:_|$)/);
    return match ? [Number(match[1])] : [];
  }).filter(Number.isInteger);
  return attempts.length ? Math.max(...attempts) + 1 : 0;
}
function sourceAttemptsExhausted(batch) {
  return terminalSourceExhausted(batch)
    || sourceAttempt(batch && batch.mineFunnel) > MAX_REFILL_ATTEMPTS;
}
function terminalSourceExhausted(batch) {
  return funnelRows(batch && batch.mineFunnel).some((row) => (
    String(row.stage || "").startsWith(QUOTA_SOURCE_PREFIX)
      && row.terminal === true
      && (String(row.reason || "") === "operator_query_cycle_exhausted"
        || Number(row.rejected?.operator_query_cycle_exhausted) > 0
        // The intake compile hitting its terminal state (certification refused
        // every remaining candidate) is as terminal as query exhaustion: when
        // certified rows already exist the batch must DRAIN and send them,
        // not strand finished sites behind a halt (2026-09-01:
        // line_mti8u213 halted compile_terminal with 15 gate_passed sites,
        // sent: 0).
        || String(row.reason || "") === "intake_genie_compile_terminal")
  ));
}

// The compile-terminal marker rides its own funnel row (written by the
// continuation as intake_genie_terminal_pick_v1 / error_code), so the
// query-exhaustion shape above cannot see it. Same drain semantics:
// certified rows exist, mining is structurally done — drain and send.
function compileTerminalDrainAllowed(batch) {
  return funnelRows(batch && batch.mineFunnel).some((row) => (
    String(row.stage || "") === "intake_genie_terminal_pick_v1"
      && String(row.error_code || "") === "intake_genie_compile_terminal"
  ));
}
function terminalCertifiedDrainAllowed(batch) {
  if (String(batch?.lane || "") !== "sandbox") return false;
  if (!terminalSourceExhausted(batch) && !compileTerminalDrainAllowed(batch)) return false;
  return (Array.isArray(batch?.rows) ? batch.rows : []).some((row) => (
    row?.genieContentCertified === true && !lineState.isFailed(String(row.status || ""))
  ));
}
function sourceExhausted(batch) {
  return finishedQuotaEnabled(batch)
    && remainingFinishedQuota(batch) > 0
    && activeRows(batch).length === 0
    && sourceAttemptsExhausted(batch);
}
function openVerticalNames(input) {
  const supplied = Array.isArray(input) ? input : buildableVerticals();
  const available = new Set(supplied
    .filter((row) => row && (typeof row === "string"
      // An outreach-retired vertical is closed to mining; a donor-excluded
      // vertical (lib/donor-exclusions.js — every in-service donor for it is
      // owner-barred for line campaigns) is equally unselectable, so the
      // nationwide all-trades rotation never spends a source slot on it.
      || (row.outreachRetired !== true && row.donorExcluded !== true)))
    .map((row) => normalizedVertical(typeof row === "string" ? row : row.vertical))
    .filter(Boolean));
  return ALL_TRADES_VERTICAL_ORDER.filter((vertical) => available.has(vertical));
}
function normalizedVertical(value) { return String(value || "").trim().toLowerCase(); }
function campaignVerticalCounts(batch, verticals = openVerticalNames()) {
  const allowed = new Set(verticals.map(normalizedVertical));
  const counts = Object.fromEntries([...allowed].map((vertical) => [vertical, 0]));
  for (const row of (batch && Array.isArray(batch.rows) ? batch.rows : [])) {
    if (!row || ["rejected", "gate_failed", "error"].includes(String(row.status || ""))) continue;
    const vertical = normalizedVertical(row.vertical);
    if (allowed.has(vertical)) counts[vertical] += 1;
  }
  return counts;
}
function campaignSourceOffset(batchId, domain, size) {
  const count = Math.max(0, Number(size) || 0);
  const durableId = String(batchId || "").trim();
  if (!durableId || count < 2) return 0;
  const digest = createHash("sha256")
    .update(`line_campaign_source_v1\0${String(domain || "source")}\0${durableId}`)
    .digest();
  return digest.readUInt32BE(0) % count;
}
function leastRepresentedVertical(batch, verticals, attempt = 0, rotation = 0) {
  if (!verticals.length) return "";
  const counts = campaignVerticalCounts(batch, verticals);
  const minimum = Math.min(...verticals.map((vertical) => counts[vertical] || 0));
  const tied = verticals.filter((vertical) => (counts[vertical] || 0) === minimum);
  return tied[(Math.max(0, rotation) + Math.max(0, attempt)) % tied.length] || verticals[0];
}
function safeSlug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 54) || "source";
}
function allTradesTarget(value) {
  const target = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  return target === "all trades" || target === "all trades nationwide";
}
function balancedAllTradesSource(batch, { attempt, verticals, metros, environment = process.env }) {
  if (!verticals.length || !metros.length) {
    // All Trades is a fresh-customer campaign. If its deliberate service-donor
    // roster cannot be loaded, fail closed instead of silently converting the
    // campaign into a read of historical LeadMiner packet inventory.
    return {
      target: "",
      attempt,
      mode: "fresh_source_unavailable",
      chunk: 0,
      unavailable: true,
      reason: "fresh_source_unavailable",
    };
  }
  const verticalOffset = campaignSourceOffset(batch?.batchId, "vertical", verticals.length);
  const metroOffset = campaignSourceOffset(batch?.batchId, "metro", metros.length);
  const vertical = leastRepresentedVertical(batch, verticals, attempt, verticalOffset);
  const minerCategory = ALL_TRADES_MINER_CATEGORY[vertical] || vertical;
  // The SHAPE rotates per attempt (metro -> region -> zip -> ...); the metro
  // shape keeps its historical batch-stable offset advance.
  const shape = queryShapeForAttempt(attempt);
  const place = shape === "region"
    ? regionTokenForAttempt(batch?.batchId, attempt)
    : shape === "zip"
      ? zipTokenForAttempt(batch?.batchId, attempt)
      : metros[(metroOffset + Math.max(0, attempt)) % metros.length];
  return {
    target: `${minerCategory} in ${place}`,
    attempt,
    mode: "fresh_all_trades_balanced",
    queryShape: shape,
    chunk: Math.min(sourceDeficit(batch, environment), DEFAULT_SOURCE_CHUNK),
  };
}

function nextQuotaSource(batch, options = {}) {
  const original = String(batch && batch.target || "").trim();
  const attempt = sourceAttempt(batch && batch.mineFunnel);
  if (String(batch && batch.status || "") === "halted") {
    return {
      target: "",
      attempt,
      mode: "batch_halted",
      chunk: 0,
      unavailable: true,
      reason: "batch_halted",
    };
  }
  const metros = Array.isArray(options.metros) && options.metros.length ? options.metros.map(String) : NATIONWIDE_METROS;
  const verticals = openVerticalNames(options.verticals);
  const environment = options.environment || process.env;

  if (original.toLowerCase() === "leadminer") {
    return {
      target: "leadminer",
      attempt,
      mode: attempt === 0 ? "packet_shelf_balanced_seed" : "packet_shelf_retry",
      chunk: Math.min(sourceDeficit(batch, environment), DEFAULT_SOURCE_CHUNK),
    };
  }
  // PAYDIRT PRE-PAIRED LEADS (owner doctrine 2026-09-02): a campaign whose
  // target is "paydirt" draws the owner's PayDirt export/deployed search —
  // business + phone (+ email when enriched) TOGETHER — through the
  // lib/prospect-sources/paydirt.js adapter. Additive: nothing changes for
  // any other target, and a not-configured/unavailable PayDirt source falls
  // through to the existing sources inside the pick (reason on the funnel).
  if (original.toLowerCase() === "paydirt") {
    return {
      target: "paydirt",
      attempt,
      mode: attempt === 0 ? "paydirt_prepaired_seed" : "paydirt_prepaired_retry",
      chunk: Math.min(sourceDeficit(batch, environment), DEFAULT_SOURCE_CHUNK),
    };
  }
  if (allTradesTarget(original)) {
    return balancedAllTradesSource(batch, { attempt, verticals, metros, environment });
  }

  const nationwide = original.match(/^(.+?)\s+nationwide$/i);
  if (nationwide && metros.length) {
    const vertical = nationwide[1].trim();
    const { shape, place } = freshSourcePlace(batch?.batchId, attempt, metros);
    return {
      target: `${vertical} in ${place}`,
      attempt,
      mode: "fresh_nationwide",
      queryShape: shape,
      chunk: Math.min(sourceDeficit(batch, environment), DEFAULT_SOURCE_CHUNK),
    };
  }
  return { target: original, attempt, mode: "fixed_market", chunk: Math.min(sourceDeficit(batch, environment), Math.max(DEFAULT_SOURCE_CHUNK, 20)) };
}

function mergeRejectedCounts(base, patch) {
  const next = base && typeof base === "object" ? { ...base } : {};
  for (const [reason, count] of Object.entries(patch && typeof patch === "object" ? patch : {})) {
    if (!String(reason || "").trim()) continue;
    const amount = Math.max(0, Number(count) || 0);
    if (!amount) continue;
    next[reason] = (Math.max(0, Number(next[reason]) || 0)) + amount;
  }
  return next;
}

function quotaDropReason(meta = {}) {
  const explicit = String(meta.reason || "").trim();
  if (explicit) return explicit;
  const target = String(meta.sourceTarget || "").trim() || "unknown_source";
  const mode = String(meta.mode || "").trim() || "unknown_mode";
  const attempt = Math.max(0, Number(meta.attempt) || 0);
  return `quota shortfall at ${target} (${mode}, attempt ${attempt})`;
}

function updateContractStage(contract, meta = {}) {
  const entered = Math.max(0, Number(meta.contractEntered) || Number(contract && contract.entered) || Number(meta.requested) || 0);
  const requested = Math.max(0, Number(meta.requested) || 0);
  const selected = Math.max(0, Number(meta.selected) || 0);
  const shortfall = Math.max(0, requested - selected);
  const previousSurvived = Math.max(0, Number(contract && contract.survived) || 0);
  const survived = Math.min(entered || Number.POSITIVE_INFINITY, previousSurvived + selected);
  let rejected = mergeRejectedCounts(contract && contract.rejected, meta.rejected);
  if (shortfall > 0) {
    rejected = mergeRejectedCounts(rejected, { [quotaDropReason(meta)]: shortfall });
  }
  const next = {
    ...(contract && typeof contract === "object" ? contract : {}),
    stage: QUOTA_CONTRACT_STAGE,
    entered,
    survived: Number.isFinite(survived) ? survived : previousSurvived + selected,
    rejected,
  };
  if (meta.quotaState && typeof meta.quotaState === "object") next.quota_state = { ...meta.quotaState };
  return next;
}

function mergeMineFunnel(previous, current, meta = {}) {
  const prior = funnelRows(previous), next = funnelRows(current);
  const attempt = Math.max(0, Number(meta.attempt) || 0), selected = Math.max(0, Number(meta.selected) || 0), requested = Math.max(0, Number(meta.requested) || 0);
  const sourceTarget = String(meta.sourceTarget || "").trim();
  const queryCycleExhausted = String(meta.reason || "").trim() === "operator_query_cycle_exhausted";
  const emptyReason = queryCycleExhausted
    ? "operator_query_cycle_exhausted"
    : "source produced no new buildable businesses; rotating automatically";
  const marker = { stage: `${QUOTA_SOURCE_PREFIX}${attempt}_${safeSlug(sourceTarget)}`, entered: requested, survived: selected,
    rejected: selected > 0 ? {} : { [emptyReason]: requested || 1 }, source_target: sourceTarget, mode: String(meta.mode || ""),
    ...(queryCycleExhausted ? { provider_attempted: false, terminal: true, reason: "operator_query_cycle_exhausted" } : {}) };
  const merged = [...prior, ...next, marker];
  const contract = updateContractStage(
    merged.find((row) => String(row.stage || "") === QUOTA_CONTRACT_STAGE),
    { ...meta, requested, selected, sourceTarget },
  );
  const rest = merged.filter((row) => String(row.stage || "") !== QUOTA_CONTRACT_STAGE);
  return [contract, ...rest.slice(-79)];
}

module.exports = { QUOTA_CONTRACT_STAGE, QUOTA_SOURCE_PREFIX, DEFAULT_SOURCE_CHUNK, MAX_REFILL_ATTEMPTS, NATIONWIDE_METROS, REGION_TOKENS, ZIP_MARKETS,
  QUERY_SHAPE_CYCLE, queryShapeForAttempt, freshSourcePlace,
  DEEP_BATCH_DEPTH_ENV, DEEP_BATCH_DEPTH_CEILING, requestedDeepBatchDepth, deepBatchDepthForBatch,
  RESUME_CAP_ENV, RESUME_CAP_DEFAULT, RESUME_CAP_CEILING, lineResumeCap,
  TARGET_MAX_POLISH_ENV, TARGET_MAX_POLISH_DEFAULT, TARGET_MAX_POLISH_CEILING, targetMaxPolish,
  ALL_TRADES_VERTICAL_ORDER, finishedQuotaEnabled, finishedRows, activeRows,
  remainingFinishedQuota, replacementDeficit, heroCandidateBudgetLimit, checkpointedHeroCandidateRows, reservedHeroCandidateRows,
  invalidReservedHeroCandidateRows, activeUncheckpointedHeroCandidateRows,
  remainingHeroCandidateBudget, remainingHeroCandidateSourceBudget, heroPaidCandidateBudgetExhausted, heroPaidCandidateBudgetBlocksCompletion,
  heroAutolineEnabled, ownerOnlyNoVideoQuota,
  gaplessLineEnabled, sourceDeficit, shouldRefill, sourceAttempt, sourceAttemptsExhausted, terminalSourceExhausted, compileTerminalDrainAllowed, terminalCertifiedDrainAllowed, sourceExhausted, openVerticalNames, campaignVerticalCounts, campaignSourceOffset, leastRepresentedVertical, allTradesTarget, balancedAllTradesSource, nextQuotaSource, mergeMineFunnel };
