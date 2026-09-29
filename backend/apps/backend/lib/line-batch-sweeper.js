"use strict";

// lib/line-batch-sweeper.js — recover ownership abandoned by dead workers.
//
// WHY THIS FILE EXISTS. Measured on production, 2026-08-10: SIX batches (hvac
// in Columbus / Portland / Indianapolis / Reno / Sacramento / Spokane, started
// ~01:10) sat status="running" with 16 rows frozen mid-build for ~30 HOURS.
// Their lambdas died mid-run — vercel.json caps every function at 300s — and
// NOTHING sweeps line batches: the edit queue got exactly this fix in
// lib/edit-job-sweeper.js, the line never did. Each stuck batch held one
// finished, gate-passed, QUEUED site, and lineState.approveBatch demands a
// settled batch, so six sendable sites were unapprovable and the owner saw no
// approve button anywhere.
//
// WHAT THIS DOES: given the durable batch list, it finds batches stuck in
// running/building/sending whose rows have not moved for STALE_BATCH_MS. Build
// rows that are at a durable phase boundary are requeued without changing the
// row status. Canonical rows also have expired worker leases released through
// an injected compare-and-swap persistence function. Terminal-only and send
// batches retain the legacy settle behavior —
//
//   · running/building -> "building" while any durable phase remains;
//                 otherwise "awaiting_approval" when it holds queued rows or
//                 "done" when every row is a non-sendable terminal,
//   · sending  -> back to "approved" when queued rows remain (the operator's
//                 approval is intact and the resumable send can simply be
//                 called again), else "done" — mirroring the settle
//                 sendApprovedBatch itself performs when it survives.
//
// WHAT IT WILL NEVER DO: start work. No build, no send, no re-run — a mirror
// deploy or an email fired on a guess about a dead lambda's progress is the
// exact class of mistake this system is built to refuse. The sweep only makes
// abandoned work claimable by the server continuation worker.
//
// WHEN IT RUNS: opportunistically, off the GET /api/admin/line status read the
// console already polls (throttled to once a minute per instance). The Vercel
// cron switch has a history of being off (see lib/edit-job-sweeper.js), so the
// registry heals itself on traffic it already gets.

const lineState = require("./line-state");

/** No live worker plausibly sits behind a row untouched this long: builds take
 *  ~1–2 minutes per row and vercel.json caps every function at 300s, so thirty
 *  minutes of zero movement across a whole batch is a dead process, not a slow
 *  one. Generous on purpose — a sweep that races a live run is worse than a
 *  sweep that waits another poll. */
const STALE_BATCH_MS = 30 * 60 * 1000;

/** A single row with an expired (or absent) lease that has not moved this long
 *  is jammed — a dead build process on one prospect while the batch still looks
 *  alive because other rows progressed. Aligned with STALE_INSPECTION_ROW_MS so
 *  lease-less render-gate rows observe ONE law: a row moved less than 10
 *  minutes ago is presumed working (main's issue-#384 contract), never swept.
 *  For rows that held a lease the 4-minute max lease plus poll headroom is
 *  already inside this window. */
const JAMMED_ROW_MS = 10 * 60 * 1000;

/** A row stuck in the render-gate (inspection) phase this long is presumed
 *  hung: the browser pool exhausted or chromium crashed silently.
 *  10 minutes is well past the gate timeout (GATE_TIMEOUT_MS ≈ 2.5 min) and
 *  the mirror timeout (MIRROR_TIMEOUT_MS = 3 min) — any legitimate inspection
 *  has either finished or timed-out by now. Two 2-minute cron ticks cover this
 *  window, so a jammed row resolves within 2 cron ticks per the acceptance
 *  criteria. */
const STALE_INSPECTION_ROW_MS = 10 * 60 * 1000;

/** How often an opportunistic caller may actually pay for a sweep. */
const SWEEP_MIN_INTERVAL_MS = 60 * 1000;
const START_WATCH_STAGE = "line_start_watch_v1";
const AUTO_REFIRE_TICKS = 2;
// Keep this aligned with line-continuation's canonical WORKER_DEADLINE_MS plus
// its persistence/teardown margin. A status-read orphan signal is only local
// to that function instance; it cannot overrule a fresh durable worker claim.
const WORKER_CLAIM_LIVENESS_MS = 255_000;

const RESUMABLE_STATES = new Set(["picked", "qualified", "mirrored", "gate_passed"]);

// THE SENTENCE on every row this module closes. It has to be true of a row
// whose worker died at an unknown point mid-build: the site was not finished,
// nothing was sent, and running the campaign again is the recovery.
const WORKER_STOPPED_SAY =
  "worker_stopped: the build process behind this campaign stopped mid-run and never came back, so this site was not finished. Nothing was sent for it. Run a new campaign to build it.";

// THE SENTENCE for a row whose render-gate (inspection) phase timed out.
// The browser pool exhausted or chromium crashed silently; the gate never
// completed and nothing was sent. A new campaign retries the inspection.
const INSPECTION_TIMEOUT_SAY =
  "inspection_timed_out: the render-gate browser did not complete within the allowed time. Nothing was sent. Run a new campaign to retry this site.";

// THE SENTENCE for a row whose mirror_build phase timed out.
// The Vercel deploy-poll hung or the browser pool exhausted inside the build;
// the site was never deployed and nothing was sent. A new campaign retries.
const MIRROR_BUILD_TIMEOUT_SAY =
  "mirror_build_timed_out: the mirror build or deploy did not complete within the allowed time. Nothing was sent. Run a new campaign to retry this site.";

function parseStamp(value) {
  const at = Date.parse(String(value || ""));
  return Number.isFinite(at) ? at : null;
}

function rowResumable(row) {
  return RESUMABLE_STATES.has(String((row && row.status) || ""));
}

function mineFunnelRows(value) {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}

function startWatchFrom(batch = {}) {
  return mineFunnelRows(batch.mineFunnel).find((row) => String(row.stage || "") === START_WATCH_STAGE) || null;
}

function workerClaimActive(watch, now = Date.now()) {
  const claimedAt = parseStamp(watch && watch.claimed_at);
  if (claimedAt == null) return false;
  const age = now - claimedAt;
  return age >= 0 && age < WORKER_CLAIM_LIVENESS_MS;
}

function withStartWatch(mineFunnel, patch = {}) {
  const rows = mineFunnelRows(mineFunnel).filter((row) => String(row.stage || "") !== START_WATCH_STAGE);
  const prior = mineFunnelRows(mineFunnel).find((row) => String(row.stage || "") === START_WATCH_STAGE) || {};
  return rows.concat([{ ...prior, stage: START_WATCH_STAGE, ...patch }]).slice(-80);
}

function leaseActive(row, now = Date.now()) {
  if (!row || !String(row.leaseToken || row.lease_token || "").trim()) return false;
  const expiresAt = parseStamp(row.leaseExpiresAt || row.lease_expires_at);
  return expiresAt != null && expiresAt > now;
}

/** True when a resumable row has an expired lease and has not moved for
 *  JAMMED_ROW_MS — a dead build process on one prospect. The batch may still
 *  look alive because other rows are progressing; this check is per-row. */
function rowJammed(row, now = Date.now()) {
  if (!RESUMABLE_STATES.has(String((row && row.status) || ""))) return false;
  if (leaseActive(row, now)) return false; // live worker still holds it
  const moved = parseStamp((row && (row.updatedAt || row.updated_at)) || null);
  return moved == null || (now - moved) >= JAMMED_ROW_MS;
}

function batchHasActiveLease(batch, now = Date.now()) {
  return (batch.rows || []).some((row) => rowResumable(row) && leaseActive(row, now));
}

function isCanonicalBatch(batch) {
  if (!batch || !Number.isInteger(batch.version)) return false;
  return (batch.rows || []).every((row) => row && String(row.rowId || row.row_id || "").trim() && Number.isInteger(row.version));
}

// Audit payloads are an explicit allowlist. The scrub is defense in depth for
// a malformed batch id; prospect rows, targets, contacts, and provider output
// never enter the event at all.
function safeAuditText(value, max = 200) {
  return String(value || "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/(?:\+?\d[\d\s().-]{5,}\d)/g, (candidate) => {
      const digits = candidate.replace(/\D/g, "");
      return digits.length >= 7 && digits.length <= 15 ? "[redacted-phone]" : candidate;
    })
    .slice(0, max);
}

function auditPayload(summary) {
  return {
    batchId: safeAuditText(summary.batchId, 160),
    was: safeAuditText(summary.was, 40),
    settledTo: safeAuditText(summary.settledTo, 40),
    closedRows: Math.max(0, Number(summary.closedRows) || 0),
    requeuedRows: Math.max(0, Number(summary.requeuedRows) || 0),
    releasedLeases: Math.max(0, Number(summary.releasedLeases) || 0),
    queued: Math.max(0, Number(summary.queued) || 0),
    staleMs: Math.max(0, Number(summary.staleMs) || 0),
  };
}

/** A row the build phase considers finished: it either made the shelf
 *  ("queued"), already shipped ("sent"), or ended in a named failure. */
function rowTerminal(row) {
  const status = String((row && row.status) || "");
  return status === "queued" || status === "sent" || lineState.isFailed(status);
}

/**
 * lastMovedAt(batch) -> ms | null
 *
 * The newest timestamp anywhere on the batch: row transitions, the batch's own
 * lifecycle stamps, and the operator's approval. Approval matters for the
 * "sending" case — its rows were last touched at build time, possibly hours
 * before the operator clicked, and the click is the movement that counts.
 */
function lastMovedAt(batch) {
  const stamps = [
    parseStamp(batch && batch.startedAt),
    parseStamp(batch && batch.createdAt),
    parseStamp(batch && batch.updatedAt),
    parseStamp(batch && batch.settledAt),
    parseStamp(batch && batch.sentAt),
    parseStamp(batch && batch.approval && batch.approval.at),
  ];
  for (const row of (batch && batch.rows) || []) {
    stamps.push(parseStamp(row && row.updatedAt));
  }
  const known = stamps.filter((at) => at != null);
  return known.length ? Math.max(...known) : null;
}

/**
 * classifyStuckBatch(batch, now) -> { state, staleMs }
 *
 *   settled   — not running/sending; none of this module's business.
 *   in_flight — a live worker plausibly still has it. Leave it alone.
 *   stale     — watched status with zero movement past the window. Recover it.
 *
 * A batch we cannot date at all (no parseable stamp anywhere) is showing the
 * operator a spinner nobody can ever satisfy — that is stale by definition.
 */
function classifyStuckBatch(batch, now = Date.now()) {
  const status = String((batch && batch.status) || "");
  // `building` is a resumable pause between server invocations. The stale
  // clock watches it so abandoned leases can be released; it does not assume
  // a browser tab owns continuation.
  if (status !== "running" && status !== "sending" && status !== "building") {
    return { state: "settled", staleMs: 0 };
  }
  if ((batch.rows || []).some((row) => rowResumable(row) && leaseActive(row, now))) {
    return { state: "in_flight", staleMs: 0 };
  }
  const moved = lastMovedAt(batch);
  if (moved == null) return { state: "stale", staleMs: 0 };
  const staleMs = Math.max(0, now - moved);
  if (staleMs < STALE_BATCH_MS) return { state: "in_flight", staleMs };
  return { state: "stale", staleMs };
}

/** Close only an unknown legacy row state. Known phase checkpoints are never
 *  routed here; canonical schemas fail closed instead of inventing a state. */
function closeFrozenRow(row, nowIso, say = WORKER_STOPPED_SAY) {
  const base = Array.isArray(row.history) ? row : { ...row, history: [] };
  const advanced = lineState.advanceRow(base, "error", { reason: say, now: nowIso });
  if (advanced.ok) return advanced.row;
  // Belt and braces for a snapshot shape advanceRow refuses — the row still
  // must stop telling somebody "working".
  return {
    ...base,
    status: "error",
    reason: say,
    updatedAt: nowIso,
    history: base.history.concat([{ status: "error", at: nowIso, reason: say }]),
  };
}

/**
 * failStaleInspectionRows(batch, now, nowIso)
 *
 * Pure: returns a NEW batch with any `mirrored` row that has not advanced in
 * more than STALE_INSPECTION_ROW_MS failed as `error`, and the batch status
 * settled to the correct resting state ("awaiting_approval" or "done").
 * Returns the original batch reference if no rows are timed out.
 *
 * Only fires when the WHOLE batch has gone quiet for STALE_INSPECTION_ROW_MS:
 * if any batch-level timestamp is recent, a live worker is plausibly running
 * and slow rows just haven't had their turn yet. The production jam scenario
 * (browser pool crashed, ALL rows stuck, zero batch-level movement for 20+
 * minutes) always satisfies this condition.
 *
 * Called on EVERY running/building legacy batch every sweep tick — independently
 * of the 30-minute STALE_BATCH_MS threshold — so a jammed render-gate row is
 * caught within 2 cron ticks (each 2 min) per the acceptance criteria.
 */
function failStaleInspectionRows(batch, now, nowIso) {
  // Halt is an operator terminal boundary. A delayed sweeper must preserve the
  // snapshot exactly, even when its rows look otherwise eligible for timeout.
  if (String((batch && batch.status) || "") === "halted") {
    return { batch, failed: 0 };
  }
  // If the batch itself moved recently a live worker is plausibly running:
  // a slow row has a real owner and must not be crashed out from under it.
  const batchMoved = lastMovedAt(batch);
  if (batchMoved !== null && now - batchMoved < STALE_INSPECTION_ROW_MS) {
    return { batch, failed: 0 };
  }

  let failed = 0;
  const rows = (batch.rows || []).map((row) => {
    if (String((row && row.status) || "") !== "mirrored") return row;
    // A canonical row with an active lease has a live worker — leave it alone.
    if (leaseActive(row, now)) return row;
    const updatedAt = parseStamp(row && row.updatedAt);
    if (updatedAt == null || now - updatedAt < STALE_INSPECTION_ROW_MS) return row;
    failed += 1;
    return closeFrozenRow(row, nowIso, INSPECTION_TIMEOUT_SAY);
  });
  if (!failed) return { batch, failed: 0 };

  // Settle the batch to the correct resting state so the staleness check
  // below sees it as settled and skips a second write.
  const settled = { ...batch, rows };
  const counts = lineState.batchCounts(settled);
  settled.status = counts.queued > 0 ? "awaiting_approval" : "done";
  if (!settled.settledAt) settled.settledAt = nowIso;
  settled.sweep = {
    at: nowIso,
    was: String(batch.status || ""),
    closedRows: failed,
    requeuedRows: 0,
    staleMs: batchMoved != null ? now - batchMoved : 0,
    reason: "inspection_timed_out",
  };
  return { batch: settled, failed };
}

/**
 * failStaleMirrorBuildRows(batch, now, nowIso)
 *
 * Pure: returns a NEW batch with any `qualified` row (the mirror_build phase)
 * that has not advanced in more than STALE_INSPECTION_ROW_MS failed as `error`,
 * and the batch status settled to the correct resting state. Returns the
 * original batch reference if no rows are timed out.
 *
 * Mirrors failStaleInspectionRows exactly, but targets the mirror_build phase
 * (status "qualified") instead of the render-gate phase (status "mirrored").
 * Production incident 2026-08-27: 10 rows sat ACTIVE in mirror_build with
 * ZERO completed samples for 16+ minutes — the Vercel deploy-poll hung or the
 * browser pool exhausted under 10-wide concurrency and NOTHING timed them out.
 * This closes that gap within 2 cron ticks, matching the acceptance criteria.
 */
function failStaleMirrorBuildRows(batch, now, nowIso) {
  // See failStaleInspectionRows: halted means no automatic lifecycle repair.
  if (String((batch && batch.status) || "") === "halted") {
    return { batch, failed: 0 };
  }
  // If the batch itself moved recently a live worker is plausibly running:
  // a slow row has a real owner and must not be crashed out from under it.
  const batchMoved = lastMovedAt(batch);
  if (batchMoved !== null && now - batchMoved < STALE_INSPECTION_ROW_MS) {
    return { batch, failed: 0 };
  }

  let failed = 0;
  const rows = (batch.rows || []).map((row) => {
    if (String((row && row.status) || "") !== "qualified") return row;
    // A canonical row with an active lease has a live worker — leave it alone.
    if (leaseActive(row, now)) return row;
    const updatedAt = parseStamp(row && row.updatedAt);
    if (updatedAt == null || now - updatedAt < STALE_INSPECTION_ROW_MS) return row;
    failed += 1;
    return closeFrozenRow(row, nowIso, MIRROR_BUILD_TIMEOUT_SAY);
  });
  if (!failed) return { batch, failed: 0 };

  // Settle the batch to the correct resting state.
  const settled = { ...batch, rows };
  const counts = lineState.batchCounts(settled);
  settled.status = counts.queued > 0 ? "awaiting_approval" : "done";
  if (!settled.settledAt) settled.settledAt = nowIso;
  settled.sweep = {
    at: nowIso,
    was: String(batch.status || ""),
    closedRows: failed,
    requeuedRows: 0,
    staleMs: batchMoved != null ? now - batchMoved : 0,
    reason: "mirror_build_timed_out",
  };
  return { batch: settled, failed };
}

/**
 * settleStuckBatch(batch, verdict, nowIso) -> { batch, closedRows, settledTo }
 * the input may be the runner's live registry object). Resumable checkpoints
 * remain byte-for-byte the same objects and make the batch `building`;
 * terminal-only/send batches retain the legacy settle behavior. There is no
 * path out of here that starts work.
 */
function settleStuckBatch(batch, verdict, nowIso = new Date().toISOString()) {
  const was = String(batch.status || "");
  // A halt is explicit operator intent, not a recoverable stale state. This
  // guard protects direct/late callers as well as the main sweep loop.
  if (was === "halted") {
    return { batch, closedRows: 0, requeuedRows: 0, settledTo: "halted" };
  }
  let closedRows = 0;
  let requeuedRows = 0;
  const rows = (batch.rows || []).map((row) => {
    if (rowTerminal(row)) return row;
    if (rowResumable(row)) {
      requeuedRows += 1;
      return row;
    }
    closedRows += 1;
    return closeFrozenRow(row, nowIso);
  });
  const swept = { ...batch, rows };
  const counts = lineState.batchCounts(swept);

  let settledTo;
  if (requeuedRows > 0) {
    // A durable phase boundary is recoverable work, never a permanent error.
    // `building` means no worker is assumed alive; the server continuation or
    // rescue cron may claim it. The sweeper itself cannot execute that work.
    settledTo = "building";
  } else if (was === "sending") {
    // The rows still queued were APPROVED and never reached — they are not
    // failures, they are the resumable send's remaining work. Approval is
    // per-batch and already stamped; restoring "approved" re-opens exactly
    // the path sendApprovedBatch left off on. Without an approval record the
    // state machine could never have reached "sending", but if a snapshot
    // shows it anyway, "awaiting_approval" makes the human gate run again —
    // fail toward MORE human approval, never less.
    if (counts.queued > 0) settledTo = swept.approval && swept.approval.at ? "approved" : "awaiting_approval";
    else settledTo = "done";
  } else {
    settledTo = counts.queued > 0 ? "awaiting_approval" : "done";
  }

  swept.status = settledTo;
  if (settledTo === "building") swept.settledAt = null;
  else if (!swept.settledAt) swept.settledAt = nowIso;
  // The audit stamp, on the batch itself: what the sweep did and why, so the
  // console can say "closed by the sweeper after 30 stalled hours" instead of
  // leaving the settle unexplained.
  swept.sweep = {
    at: nowIso,
    was,
    closedRows,
    requeuedRows,
    staleMs: verdict && Number.isFinite(verdict.staleMs) ? verdict.staleMs : 0,
    reason: requeuedRows > 0 ? "worker_requeued" : "worker_stopped",
  };
  return { batch: swept, closedRows, requeuedRows, settledTo };
}

/**
 * sweepLineBatches(deps) -> { ok, examined, swept: [{batchId, was, settledTo, closedRows, queued}] }
 *
 * deps:
 *   listBatches() -> legacy array OR canonical {ok,batches}
 *   putBatch(batch)  legacy registry + snapshot writer
 *   releaseRow(input) canonical compare-and-swap lease release
 *   storeBatch(input) canonical compare-and-swap batch writer
 *   recordEvent(type, payload) optional PII-free audit trail
 *
 * Never throws: a sweep that failed must not take down the status read it was
 * hitching a ride on. One unwritable batch must not stop the rest.
 */
async function sweepLineBatches({
  listBatches,
  putBatch,
  releaseRow,
  storeBatch,
  recordEvent,
  refireBatch,
  orphanSignal = false,
  now = Date.now(),
  staleMs = STALE_BATCH_MS,
} = {}) {
  if (typeof listBatches !== "function" || (typeof putBatch !== "function" && typeof storeBatch !== "function")) {
    return { ok: false, examined: 0, swept: [], error: "registry_unavailable" };
  }
  let listed;
  try {
    listed = await listBatches();
  } catch (error) {
    return { ok: false, examined: 0, swept: [], error: safeAuditText((error && error.message) || error) };
  }
  if (!Array.isArray(listed) && listed && listed.ok === false) {
    return { ok: false, examined: 0, swept: [], error: safeAuditText(listed.error || "registry_unavailable") };
  }
  const validList = Array.isArray(listed) || (listed && listed.ok === true && Array.isArray(listed.batches));
  if (!validList) {
    return { ok: false, examined: 0, swept: [], error: "registry_invalid_response" };
  }
  const list = Array.isArray(listed) ? listed : listed.batches;
  const swept = [];
  const failures = [];
  const refired = [];
  for (let batch of list) {
    if (!batch || !batch.batchId) continue;
    const status = String(batch.status || "");
    // Absolute boundary: do not touch a halted batch. In particular, do not
    // release stale leases, settle/reopen rows, tick an orphan watch, or refire
    // a delayed queue message. The exact stored snapshot remains authoritative.
    if (status === "halted") continue;
    let refiredThisTick = false; // prevent double-refire when watch-tick and jammed-row both trigger
    const watch = startWatchFrom(batch);
    // GET /api/admin/line can only see workers owned by its current instance.
    // The durable claim is authoritative during the worker liveness window:
    // do not tick/reset its watch, refire it, or stale-settle it underneath
    // the live worker's release CAS, even before that worker creates rows.
    if (status === "running" && workerClaimActive(watch, now)) continue;
    if (watch && ["building", "running"].includes(status)) {
      const orphaned = status === "running"
        && orphanSignal === true
        && !batchHasActiveLease(batch, now);
      const unclaimed = status === "building" && !String(watch.claimed_at || "").trim();
      const tickField = orphaned ? "orphan_ticks" : unclaimed ? "unclaimed_ticks" : "";
      const tickBase = tickField ? Math.max(0, Number(watch[tickField]) || 0) : 0;
      if (!tickField && (Number(watch.unclaimed_ticks) || Number(watch.orphan_ticks))) {
        const resetFunnel = withStartWatch(batch.mineFunnel, {
          unclaimed_ticks: 0,
          orphan_ticks: 0,
        });
        try {
          if (isCanonicalBatch(batch)) {
            if (typeof storeBatch !== "function") throw new Error("canonical_store_unavailable");
            await storeBatch({
              batchId: batch.batchId,
              expectedVersion: batch.version,
              expectedStatus: batch.status,
              patch: { mineFunnel: resetFunnel },
            });
          } else if (typeof putBatch === "function") {
            await putBatch({ ...batch, mineFunnel: resetFunnel });
          }
        } catch { /* best-effort watch reset */ }
      }
      if (tickField) {
        const nextTicks = tickBase + 1;
        let latestBatch = batch;
        let persistedWatch = watch;
        try {
          const nextFunnel = withStartWatch(batch.mineFunnel, { [tickField]: nextTicks });
          if (isCanonicalBatch(batch)) {
            if (typeof storeBatch !== "function") throw new Error("canonical_store_unavailable");
            const stored = await storeBatch({
              batchId: batch.batchId,
              expectedVersion: batch.version,
              expectedStatus: batch.status,
              patch: { mineFunnel: nextFunnel },
            });
            if (!stored || stored.ok !== true || !stored.batch) {
              throw new Error(`canonical_store_failed:${safeAuditText(stored && stored.error, 100) || "unknown"}`);
            }
            latestBatch = stored.batch;
          } else if (typeof putBatch === "function") {
            latestBatch = { ...batch, mineFunnel: nextFunnel };
            await putBatch(latestBatch);
          }
          persistedWatch = startWatchFrom(latestBatch) || persistedWatch;
          if (nextTicks >= AUTO_REFIRE_TICKS && typeof refireBatch === "function") {
            const acceptedSequence = Math.max(0, Number(persistedWatch.accepted_sequence) || 0);
            const refireCount = Math.max(0, Number(persistedWatch.refire_count) || 0);
            const publication = await refireBatch({
              batchId: latestBatch.batchId,
              phase: "run",
              sequence: acceptedSequence + refireCount + 1,
              acceptedRunId: String(persistedWatch.accepted_run_id || ""),
              reason: orphaned ? "orphaned_running_batch" : "accepted_unclaimed_batch",
            });
            if (publication && publication.accepted === true) {
              const postRefire = withStartWatch(latestBatch.mineFunnel, {
                [tickField]: 0,
                refire_count: refireCount + 1,
                last_refire_at: new Date(now).toISOString(),
                last_refire_reason: orphaned ? "orphaned_running_batch" : "accepted_unclaimed_batch",
              });
              if (isCanonicalBatch(latestBatch)) {
                if (typeof storeBatch !== "function") throw new Error("canonical_store_unavailable");
                await storeBatch({
                  batchId: latestBatch.batchId,
                  expectedVersion: latestBatch.version,
                  expectedStatus: latestBatch.status,
                  patch: { mineFunnel: postRefire },
                });
              } else if (typeof putBatch === "function") {
                await putBatch({ ...latestBatch, mineFunnel: postRefire });
              }
              refired.push({
                batchId: latestBatch.batchId,
                reason: orphaned ? "orphaned_running_batch" : "accepted_unclaimed_batch",
              });
              refiredThisTick = true;
            }
          }
        } catch (error) {
          failures.push({
            batchId: safeAuditText(batch.batchId, 160),
            error: safeAuditText((error && error.message) || error),
          });
        }
      }
    }
    // PER-ROW INSPECTION TIMEOUT. A row stuck in `mirrored` (the render-gate
    // phase) for longer than STALE_INSPECTION_ROW_MS is failed immediately —
    // independently of the 30-minute STALE_BATCH_MS batch window — so a
    // crashed browser pool resolves within 2 cron ticks. Legacy batches only:
    // canonical rows use row leases that already signal in-flight status, and
    // the leaseActive() guard inside failStaleInspectionRows skips those rows.
    if (["building", "running"].includes(status) && !isCanonicalBatch(batch) && typeof putBatch === "function") {
      const nowIso = new Date(now).toISOString();
      const timedOut = failStaleInspectionRows(batch, now, nowIso);
      if (timedOut.failed > 0) {
        try {
          await putBatch(timedOut.batch);
          if (typeof recordEvent === "function") {
            await recordEvent("line.inspection_rows_timed_out", {
              batchId: safeAuditText(batch.batchId, 160),
              failedRows: timedOut.failed,
            });
          }
          // Refresh the local reference so the staleness check below sees the
          // updated row statuses (failed rows no longer count as resumable).
          batch = timedOut.batch;
        } catch { /* best-effort — the staleness check still runs below */ }
      }
      // PER-ROW MIRROR_BUILD TIMEOUT. A row stuck in `qualified` (the
      // mirror_build phase) is treated exactly like a stale inspection row:
      // failed immediately so the pool moves on within 2 cron ticks.
      // Production incident 2026-08-27: 10 rows sat ACTIVE in mirror_build
      // with zero completed samples; the deploy-poll or browser pool hung
      // and NOTHING freed them. See issue #459.
      const buildTimedOut = failStaleMirrorBuildRows(batch, now, nowIso);
      if (buildTimedOut.failed > 0) {
        try {
          await putBatch(buildTimedOut.batch);
          if (typeof recordEvent === "function") {
            await recordEvent("line.mirror_build_rows_timed_out", {
              batchId: safeAuditText(batch.batchId, 160),
              failedRows: buildTimedOut.failed,
            });
          }
          batch = buildTimedOut.batch;
        } catch { /* best-effort — the staleness check still runs below */ }
      }
    }
    const verdict = classifyStuckBatch(batch, now);
    // JAMMED ROW SWEEP — runs only for non-stale batches; stale batches are
    // handled below by settleStuckBatch which closes all rows in one pass.
    // A single row whose lease expired and has not moved for JAMMED_ROW_MS is a
    // dead build process. The batch may still look alive because other rows
    // progressed, so the 30-minute stale clock never fires. Close the jammed
    // row fast and refire so the quota replacement loop claims the next shelf
    // prospect within one cron tick. Canonical schemas require checkpointRow for
    // proper row closure (not injected here), so for canonical batches we only
    // release the expired lease and refire; the continuation worker retries the
    // row naturally and the existing MAX_BUILD_RETRY_ATTEMPTS cap eventually
    // fails it. Legacy batches get the full closeFrozenRow treatment.
    if (verdict.state !== "stale" && ["running", "building"].includes(status)) {
      const jammable = (batch.rows || []).filter((row) => rowJammed(row, now));
      if (jammable.length) {
        const nowIso = new Date(now).toISOString();
        try {
          if (isCanonicalBatch(batch)) {
            if (typeof releaseRow !== "function") throw new Error("canonical_release_unavailable");
            for (const row of jammable) {
              const leaseToken = String(row.leaseToken || row.lease_token || "").trim();
              if (!leaseToken) continue;
              await releaseRow({
                rowId: row.rowId || row.row_id,
                leaseToken,
                expectedVersion: row.version,
                expectedStatus: row.status,
              }).catch(() => {}); // best-effort; continuation re-claims on next tick
            }
          } else {
            if (typeof putBatch !== "function") throw new Error("legacy_store_unavailable");
            const jammableIds = new Set(jammable.map((r) => String(r.rowId || r.row_id || r.prospectId || "")));
            const nextRows = (batch.rows || []).map((row) => {
              const id = String(row.rowId || row.row_id || row.prospectId || "");
              return jammableIds.has(id) && rowJammed(row, now) ? closeFrozenRow(row, nowIso) : row;
            });
            const nextBatch = {
              ...batch,
              rows: nextRows,
              status: "building",
              settledAt: null,
              sweep: {
                at: nowIso,
                was: status,
                closedRows: jammable.length,
                requeuedRows: 0,
                staleMs: 0,
                reason: "jammed_row_replaced",
              },
            };
            const persisted = await putBatch(nextBatch);
            if (persisted && persisted.ok === false) throw new Error("legacy_jammed_store_failed");
          }
          // Refire so the continuation's quota.shouldRefill pick runs within one
          // cron tick. Best-effort: if the queue refuses, the watch-tick refire
          // or the next stale sweep will recover. Skip if the watch-tick
          // mechanism already refired this batch in this sweep pass.
          if (!refiredThisTick && typeof refireBatch === "function") {
            const batchWatch = startWatchFrom(batch) || {};
            const acceptedSequence = Math.max(0, Number(batchWatch.accepted_sequence) || 0);
            const refireCount = Math.max(0, Number(batchWatch.refire_count) || 0);
            const pub = await refireBatch({
              batchId: batch.batchId,
              phase: "run",
              sequence: acceptedSequence + refireCount + 1,
              acceptedRunId: String(batchWatch.accepted_run_id || ""),
              reason: "jammed_row_replaced",
            }).catch(() => null);
            if (pub && pub.accepted === true) {
              refired.push({ batchId: batch.batchId, reason: "jammed_row_replaced" });
            }
          }
        } catch (error) {
          failures.push({
            batchId: safeAuditText(batch.batchId, 160),
            error: safeAuditText((error && error.message) || error),
          });
        }
      }
    }
    if (verdict.state !== "stale") continue;
    // Respect a caller-widened window too (tests drive time directly).
    if (verdict.staleMs > 0 && verdict.staleMs < staleMs) continue;
    try {
      const closed = settleStuckBatch(batch, verdict, new Date(now).toISOString());
      let releasedLeases = 0;
      if (isCanonicalBatch(batch)) {
        if (typeof storeBatch !== "function") throw new Error("canonical_store_unavailable");
        // Canonical schemas permit only known row states. Refuse a malformed
        // row instead of inventing a durable transition outside checkpointRow.
        if (closed.closedRows > 0) throw new Error("canonical_row_state_invalid");
        for (const row of batch.rows || []) {
          if (!rowResumable(row)) continue;
          const leaseToken = String(row.leaseToken || row.lease_token || "").trim();
          if (!leaseToken) continue;
          if (leaseActive(row, now)) throw new Error("canonical_lease_still_active");
          if (typeof releaseRow !== "function") throw new Error("canonical_release_unavailable");
          const release = await releaseRow({
            rowId: row.rowId || row.row_id,
            leaseToken,
            expectedVersion: row.version,
            expectedStatus: row.status,
          });
          if (!release || release.ok !== true) {
            throw new Error(`canonical_release_failed:${safeAuditText(release && release.error, 100) || "unknown"}`);
          }
          releasedLeases += 1;
        }
        const patch = { status: closed.settledTo };
        if (closed.settledTo === "building") patch.settledAt = null;
        else if (closed.settledTo === "awaiting_approval" || closed.settledTo === "done") {
          patch.settledAt = closed.batch.settledAt;
        }
        const stored = await storeBatch({
          batchId: batch.batchId,
          expectedVersion: batch.version,
          expectedStatus: batch.status,
          patch,
        });
        if (!stored || stored.ok !== true) {
          throw new Error(`canonical_store_failed:${safeAuditText(stored && stored.error, 100) || "unknown"}`);
        }
      } else {
        if (typeof putBatch !== "function") throw new Error("legacy_store_unavailable");
        // Await even synchronous legacy writers. A rejected snapshot must
        // never be reported as a successful rescue.
        const persisted = await putBatch(closed.batch);
        if (persisted && persisted.ok === false) {
          throw new Error(`legacy_store_failed:${safeAuditText(persisted.error, 100) || "unknown"}`);
        }
      }
      const counts = lineState.batchCounts(closed.batch);
      const summary = {
        batchId: batch.batchId,
        was: String(batch.status || ""),
        settledTo: closed.settledTo,
        closedRows: closed.closedRows,
        requeuedRows: closed.requeuedRows,
        releasedLeases,
        queued: counts.queued,
        staleMs: verdict.staleMs,
      };
      swept.push(summary);
      if (typeof recordEvent === "function") {
        await recordEvent("line.batch_swept", auditPayload(summary));
      }
    } catch (error) {
      failures.push({
        batchId: safeAuditText(batch.batchId, 160),
        error: safeAuditText((error && error.message) || error),
      });
      // The next status read tries again; the remaining batches still recover.
    }
  }
  return { ok: failures.length === 0, examined: list.length, swept, refired, failures };
}

// ---- opportunistic trigger --------------------------------------------------
// Per-instance, so a busy lambda pays for at most one sweep a minute and a
// cold one pays on its first status read — which is exactly when the owner has
// just opened the console onto a batch that died.
let lastSweepAt = 0;

/** Reset between tests; also the honest way for an operator path to force one. */
function resetSweepThrottle() {
  lastSweepAt = 0;
}

async function maybeSweepLineBatches(deps = {}) {
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const interval = Number.isFinite(deps.minIntervalMs) ? deps.minIntervalMs : SWEEP_MIN_INTERVAL_MS;
  if (lastSweepAt && now - lastSweepAt < interval) {
    return { ok: true, skipped: "throttled", examined: 0, swept: [] };
  }
  lastSweepAt = now;
  return sweepLineBatches({ ...deps, now });
}

module.exports = {
  STALE_BATCH_MS,
  JAMMED_ROW_MS,
  SWEEP_MIN_INTERVAL_MS,
  START_WATCH_STAGE,
  AUTO_REFIRE_TICKS,
  WORKER_CLAIM_LIVENESS_MS,
  WORKER_STOPPED_SAY,
  RESUMABLE_STATES,
  lastMovedAt,
  workerClaimActive,
  rowResumable,
  rowJammed,
  leaseActive,
  isCanonicalBatch,
  auditPayload,
  classifyStuckBatch,
  settleStuckBatch,
  failStaleInspectionRows,
  failStaleMirrorBuildRows,
  sweepLineBatches,
  maybeSweepLineBatches,
  resetSweepThrottle,
};
