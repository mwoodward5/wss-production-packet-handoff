"use strict";

// Production timing + evidence wrapper for the durable Line worker.
//
// Production evidence on 2026-08-18 showed valid Mirror Engine rows repeatedly
// reaching the old 180s/210s mirror timeout while Firecrawl itself had 0ms
// permit wait and uploads completed in ~1s. The Vercel functions are allowed
// 300s. Keep the proven Line state machine unchanged, but give its production
// worker enough envelope to finish one irreversible mirror and checkpoint it.
//
// Production evidence on 2026-08-19 then measured three concurrent MedSpa
// mirrors completing their network/render work at ~263s, only to be killed by
// the 260s mirror phase timer. This is not a prospect or QC failure. Widen the
// measured production envelope just enough to let that work checkpoint while
// retaining a hard safety gap below the 300s Vercel ceiling.
//
// Two production findings were evidence/QC-transport bugs, not quality
// failures: signed photo placement did not reach sourceFactsFor, and the
// landscaping donor's adjacent property vocabulary could be convicted by the
// global trade-swap scanner. The production adapters reconnect that evidence
// while leaving all 12 render facts and thresholds intact.
//
// All-Trades refill also has to preserve the packet-aware LeadMiner contract:
// an identified packet with build_ready:false is `needs_fill`, not an ordinary
// mined-contract rejection. line-production-pick applies that rule only after
// reloading and proving the canonical LeadMiner packet source.
//
// 662s effective worker deadline
// 650s mirror phase deadline
// 672s durable row lease
// 800s Vercel hard ceiling (build-running functions raised 2026-09-01;
// the previous 300s ladder aborted every full-length mirror mid-flight)
//
// The mirror phase leaves 12s for the durable checkpoint/response, and the row
// lease stays another 10s beyond the worker deadline so a second worker cannot
// reclaim the row while the first is persisting its result.

const base = require("./line-continuation");
const persistenceDefaults = require("./line-persistence");
const { createProductionSourceFacts } = require("./line-production-source-facts");
const { createProductionGate } = require("./line-production-gate");
const { createProductionPick } = require("./line-production-pick");
const { captureLineEmailAssets } = require("./line-email-assets");

const VERCEL_FUNCTION_CEILING_MS = 800_000;
const WORKER_DEADLINE_EXTENSION_MS = 437_000;
const EFFECTIVE_WORKER_DEADLINE_MS = base.WORKER_DEADLINE_MS + WORKER_DEADLINE_EXTENSION_MS;
const MIRROR_PHASE_TIMEOUT_MS = 650_000;
const ROW_LEASE_MS = 672_000;

if (!(MIRROR_PHASE_TIMEOUT_MS < EFFECTIVE_WORKER_DEADLINE_MS
  && EFFECTIVE_WORKER_DEADLINE_MS < ROW_LEASE_MS
  && ROW_LEASE_MS < VERCEL_FUNCTION_CEILING_MS)) {
  throw new Error("line_production_timing_contract_invalid");
}

function productionClaimLimit(input = {}) {
  const requested = Math.max(1, Number(input.limit) || 1);
  const statuses = Array.isArray(input.statuses) ? input.statuses.map(String) : [];
  // Fleet width belongs to the Queue trigger. Every individual delivery owns
  // one browser-heavy mirror or render-gate row, including rescue/fallback
  // deliveries, so production can never multiply ten queue workers into
  // thirty remote browser trees inside those workers.
  if (statuses.length === 1 && ["qualified", "mirrored"].includes(statuses[0])) {
    return Math.min(requested, base.BROWSER_HEAVY_ROW_CLAIM);
  }
  return requested;
}

function widenPersistence(persistence) {
  if (!persistence || typeof persistence.claimRows !== "function") {
    throw new TypeError("line_production_persistence_invalid");
  }
  return {
    ...persistence,
    claimRows(input = {}, ...args) {
      const requestedLease = Number(input.leaseMs) || 0;
      return persistence.claimRows({
        ...input,
        limit: productionClaimLimit(input),
        leaseMs: Math.max(requestedLease, ROW_LEASE_MS),
      }, ...args);
    },
  };
}

function createProductionContinuation(dependencies = {}) {
  const sourceClock = dependencies.clock || Date.now;
  const sourceNow = dependencies.now || (() => new Date().toISOString());
  const phaseDeps = dependencies.phaseDeps || {};
  const productionGate = dependencies.gate || createProductionGate({
    clock: sourceClock,
    ...(dependencies.gateDeps || {}),
  });
  const productionPick = dependencies.productionPick || createProductionPick({
    ...(dependencies.pick ? { pick: dependencies.pick } : {}),
    ...(dependencies.select ? { select: dependencies.select } : {}),
  });
  return base.createLineContinuation({
    ...dependencies,
    pick: productionPick,
    persistence: widenPersistence(dependencies.persistence || persistenceDefaults),
    sourceFacts: createProductionSourceFacts(dependencies),
    gate: productionGate,
    // LIGHT verification still shoots the email's proof shots in the gate
    // phase (line-runner's light skip). Same capture the full gate's hook
    // calls, motion extras off, on its own chromium.
    captureEmailAssets: dependencies.captureEmailAssets || captureLineEmailAssets,
    clock: () => sourceClock() + WORKER_DEADLINE_EXTENSION_MS,
    now: sourceNow,
    phaseDeps: {
      ...phaseDeps,
      mirrorTimeoutMs: Number(phaseDeps.mirrorTimeoutMs) > 0
        ? Number(phaseDeps.mirrorTimeoutMs)
        : MIRROR_PHASE_TIMEOUT_MS,
    },
  });
}

const service = createProductionContinuation();

module.exports = {
  ...service,
  createProductionContinuation,
  widenPersistence,
  productionClaimLimit,
  createProductionPick,
  createProductionSourceFacts,
  createProductionGate,
  VERCEL_FUNCTION_CEILING_MS,
  WORKER_DEADLINE_EXTENSION_MS,
  EFFECTIVE_WORKER_DEADLINE_MS,
  MIRROR_PHASE_TIMEOUT_MS,
  ROW_LEASE_MS,
};
