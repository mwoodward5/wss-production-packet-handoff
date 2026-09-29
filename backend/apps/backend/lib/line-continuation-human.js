"use strict";

// Human-first ownership layer over the production Line continuation.
//
// The operator runs one practice campaign at a time. Older idle practice runs
// must not remain labeled "production live", compete for rescue cron time, or
// make the owner decide which queue row matters. This layer preserves the
// durable state machine and all truth/send gates, while enforcing two simple
// product rules:
//   1. the newest active PRACTICE run owns the practice factory;
//   2. launching a sandbox campaign is enough to deliver owner-only proofs.
//      A live campaign always stops at durable `awaiting_approval` until the
//      owner types the exact batch id through /api/admin/line. The later send
//      still obeys the server-side live switch, pause/review holds, recipient
//      fingerprints and provider idempotency before any prospect delivery.

const productionDefaults = require("./line-continuation-production");
const persistenceDefaults = require("./line-persistence");
const { safeCode, mirrorFailureSummary } = require("./line-continuation");
const lineTelemetry = require("./line-telemetry");
const { mirrorProspectResumable } = require("./line-mirror-resume");

function stamp(batch) {
  for (const value of [batch && batch.startedAt, batch && batch.createdAt, batch && batch.updatedAt]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function leaseActive(row, now = Date.now()) {
  if (!row || !String(row.leaseToken || row.lease_token || "").trim()) return false;
  const at = Date.parse(String(row.leaseExpiresAt || row.lease_expires_at || ""));
  return Number.isFinite(at) && at > now;
}

function activePractice(batch) {
  return batch
    && batch.lane === "sandbox"
    && ["building", "running"].includes(String(batch.status || ""));
}

function terminalReasonSummary(batch) {
  const counts = {};
  for (const row of (batch && batch.rows) || []) {
    const status = String(row && row.status || "");
    if (!["rejected", "gate_failed", "error"].includes(status)) continue;
    const mirrorFailure = mirrorFailureSummary(row);
    const code = mirrorFailure.code || mirrorFailure.reason || mirrorFailure.detail
      || safeCode(row.reason || row.lastRetryableError || row.last_retryable_error || status, status);
    counts[code] = (counts[code] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }));
}

function defaultProductionService() {
  // Line-only mirror adapter: deadline interruptions are resumable on the same
  // operation key and get the duplicated engine reserve back. All genuine
  // mirror/QC refusals still flow through unchanged.
  return productionDefaults.createProductionContinuation({ mirror: mirrorProspectResumable });
}

function createHumanContinuation({
  production,
  persistence = persistenceDefaults,
  logger = console,
  environment = process.env,
} = {}) {
  const lineProduction = production || defaultProductionService();

  async function retireSupersededPracticeBatches({ now = Date.now() } = {}) {
    // includeRows:false keeps this off the OOM/timeout path. The old shape
    // loaded up to 100 batches × 1000 evidence-bearing rows into one heap on
    // EVERY queue/cron invocation (the measured out-of-memory + 300s-timeout
    // cause on /api/queues/line-batch and /api/cron/run-line-batches), then
    // discarded everything but one batchId. Selecting the run to keep needs
    // only batch-level fields; the live-lease check needs rows, so those are
    // loaded one candidate at a time below (a handful, not all 100 batches').
    const listed = await persistence.listBatches({
      statuses: ["building", "running"],
      limit: 25,
      includeRows: false,
      order: "updated_at.desc",
    });
    if (!listed || listed.ok !== true) return { ok: false, retired: 0, kept: "", error: "line_batch_list_failed" };

    const active = (listed.batches || [])
      .filter(activePractice)
      .sort((a, b) => stamp(b) - stamp(a));
    if (active.length < 2) return { ok: true, retired: 0, kept: active[0]?.batchId || "" };

    const keep = active[0];
    let retired = 0;
    let deferred = 0;
    for (const batch of active.slice(1)) {
      // Never race a real worker. Load ONLY this candidate's rows to check for a
      // live lease; an older run with a live lease finishes its current durable
      // phase and the next queue/cron pass retires it once idle.
      let rows = Array.isArray(batch.rows) && batch.rows.length ? batch.rows : null;
      if (!rows) {
        const loaded = await persistence.loadBatch(batch.batchId);
        rows = (loaded && loaded.ok === true && loaded.batch && Array.isArray(loaded.batch.rows))
          ? loaded.batch.rows
          : [];
      }
      if (rows.some((row) => leaseActive(row, now))) {
        deferred += 1;
        continue;
      }
      const stored = await persistence.storeBatch({
        batchId: batch.batchId,
        expectedVersion: batch.version,
        expectedStatus: batch.status,
        patch: {
          status: "halted",
          haltReason: `superseded_by_newer_practice_run:${keep.batchId}`,
          settledAt: new Date(now).toISOString(),
        },
      });
      if (stored && stored.ok === true) retired += 1;
    }
    return { ok: true, retired, deferred, kept: keep.batchId };
  }

  async function logHumanPass(batchId, extra = {}) {
    if (!(environment.VERCEL || environment.GHOST_AGENCY_PHASE_LOGS === "true")) return;
    try {
      const loaded = await persistence.loadBatch(batchId);
      if (!loaded || loaded.ok !== true) return;
      const batch = loaded.batch;
      const stateEvent = {
        event: "line_human_state",
        batch_id: batchId,
        status: batch.status,
        requested: Number(batch.requested) || 0,
        terminal_reasons: terminalReasonSummary(batch),
        ...extra,
      };
      // Observability volume valve (#596): `reduced` keeps the per-invocation
      // census only when it carries terminal reasons — a healthy batch's
      // census line is pure volume.
      if (lineTelemetry.shouldLogHumanState(environment, stateEvent)) {
        logger.log(JSON.stringify(stateEvent));
      }
    } catch { /* diagnostics must never affect work */ }
  }

  async function authorizeAndPublishSettledBatch(batchId) {
    const loaded = await persistence.loadBatch(batchId).catch(() => ({ ok: false }));
    if (!loaded || loaded.ok !== true || !loaded.batch) return { approved: false, skipped: "batch_unavailable" };
    const batch = loaded.batch;
    if (batch.status !== "awaiting_approval") return { approved: false, skipped: `batch_${batch.status}` };
    const queued = (batch.rows || []).filter((row) => row && row.status === "queued").length;
    if (queued < 1) return { approved: false, skipped: "nothing_queued" };

    // Owner-only proofs may finish hands-free, but a prospect send may not.
    // The explicit typed approval endpoint is the sole authority for live
    // delivery; continuation and rescue are deliberately unable to mint it.
    if (batch.lane !== "sandbox") {
      return {
        approved: false,
        skipped: batch.lane === "live"
          ? "explicit_owner_approval_required"
          : "auto_approval_refused_non_sandbox_lane",
        lane: batch.lane,
        queued,
        awaitingApproval: batch.lane === "live",
      };
    }

    // Sandbox contract: the explicit Start campaign action authorizes only
    // owner-routed proof delivery. Materialize the durable approval after the
    // exact rows pass the render gate; live batches took the refusal above.
    const approved = await persistence.approveBatch({
      batchId: batch.batchId,
      expectedVersion: batch.version,
      typedBatchId: batch.batchId,
      actor: "campaign_start_sandbox",
      approvedRows: queued,
    }).catch(() => ({ ok: false }));
    if (!approved || approved.ok !== true) return { approved: false, skipped: approved?.error || "approval_write_failed" };

    const reloaded = await persistence.loadBatch(batch.batchId).catch(() => ({ ok: false }));
    const durable = reloaded && reloaded.ok === true ? reloaded.batch : approved.batch;
    let publication = { accepted: false, skipped: "publisher_unavailable" };
    if (durable && durable.status === "approved" && typeof lineProduction.publishNext === "function") {
      publication = await lineProduction.publishNext(durable, "send").catch(() => ({ accepted: false, error: "line_queue_publish_failed" }));
    }
    return {
      approved: Boolean(durable && durable.status === "approved"),
      lane: durable?.lane || batch.lane,
      queued,
      queueAccepted: publication.accepted === true,
      recovery: publication.accepted === true ? "queue" : "cron",
    };
  }

  async function processLineMessage(message, options = {}) {
    const ownership = await retireSupersededPracticeBatches().catch(() => ({ ok: false, retired: 0 }));
    let result = await lineProduction.processLineMessage(message, options);
    const authorization = result && result.status === "awaiting_approval"
      ? await authorizeAndPublishSettledBatch(message.batchId)
      : null;
    if (authorization && authorization.approved) {
      result = {
        ...result,
        status: "approved",
        campaignApproved: true,
        deliveryQueued: authorization.queueAccepted,
        deliveryRecovery: authorization.recovery,
      };
    }
    await logHumanPass(message.batchId, {
      current_practice_batch: ownership.kept || "",
      retired_practice_batches: ownership.retired || 0,
      retirement_deferred: ownership.deferred || 0,
      ...(authorization && authorization.approved ? {
        campaign_approval: true,
        delivery_queue_accepted: authorization.queueAccepted,
        delivery_recovery: authorization.recovery,
      } : {}),
    });
    return result;
  }

  async function rescueLineBatches(options = {}) {
    const ownership = await retireSupersededPracticeBatches().catch(() => ({ ok: false, retired: 0 }));

    // If the current Practice run is parked in `building`, service it directly.
    // This avoids an older live/repair batch elsewhere in the registry consuming
    // the one rescue slot while the operator's current run sits idle.
    if (ownership.kept) {
      const loaded = await persistence.loadBatch(ownership.kept).catch(() => ({ ok: false }));
      if (loaded && loaded.ok === true && loaded.batch && loaded.batch.status === "building") {
        let result = await lineProduction.processLineMessage({
          batchId: ownership.kept,
          phase: "run",
          sequence: Math.max(Number(loaded.batch.version) || 0, 0),
        }, {
          metadata: { messageId: `human-rescue:${ownership.kept}:${Math.max(Number(loaded.batch.version) || 0, 0)}` },
        });
        const authorization = result && result.status === "awaiting_approval"
          ? await authorizeAndPublishSettledBatch(ownership.kept)
          : null;
        if (authorization && authorization.approved) {
          result = {
            ...result,
            status: "approved",
            campaignApproved: true,
            deliveryQueued: authorization.queueAccepted,
            deliveryRecovery: authorization.recovery,
          };
        }
        await logHumanPass(ownership.kept, {
          rescue: true,
          current_priority: true,
          retired_practice_batches: ownership.retired || 0,
          retirement_deferred: ownership.deferred || 0,
          ...(authorization && authorization.approved ? {
            campaign_approval: true,
            delivery_queue_accepted: authorization.queueAccepted,
            delivery_recovery: authorization.recovery,
          } : {}),
        });
        return { ...result, retired: ownership.retired || 0, currentPriority: true };
      }
    }

    const result = await lineProduction.rescueLineBatches(options);
    if (ownership.kept) {
      // A rescue can settle the current Practice batch inside the production
      // service. Materialize the campaign approval here too, so queue loss and
      // rescue ownership have identical behavior.
      await authorizeAndPublishSettledBatch(ownership.kept).catch(() => null);
      await logHumanPass(ownership.kept, {
        rescue: true,
        current_priority: false,
        retired_practice_batches: ownership.retired || 0,
        retirement_deferred: ownership.deferred || 0,
      });
    }
    return { ...result, retired: ownership.retired || 0, currentPriority: false };
  }

  return {
    processLineMessage,
    rescueLineBatches,
    retireSupersededPracticeBatches,
    logHumanPass,
    authorizeAndPublishSettledBatch,
  };
}

const service = createHumanContinuation();

module.exports = {
  ...productionDefaults,
  ...service,
  createHumanContinuation,
  defaultProductionService,
  terminalReasonSummary,
  stamp,
  leaseActive,
  activePractice,
};
