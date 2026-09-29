"use strict";

// lib/line-telemetry.js — the Observability volume valve (#596).
//
// The Vercel Observability line hit 12.95M events (+964%) because the Line
// pipeline's diagnostic oracles (#473) fire on every hot-path step:
// a per-row-phase census, a per-worker-pass summary, a per-invocation human
// census and per-probe/per-batch mirror stats — ~11.5 events/invocation.
// The diagnostics that MATTER are the terminal and error transitions; the
// happy-path phase lines are the volume.
//
// GHOST_AGENCY_LINE_TELEMETRY selects the level:
//   full    (default, and any unrecognized value) — byte-identical behavior.
//   reduced — terminal/error transitions only:
//               line_row_phase       only terminal/error row transitions
//               line_worker_pass     only passes that failed a row
//               line_human_state     only censuses carrying terminal reasons
//               mirror_resume        only unclean resume probes
//               mirror_upload_batch  only batches with missing files
//             Every warn/error elsewhere is untouched — this module gates
//             info-level JSON events only.
//
// Every helper is a PURE function of (env, event) so the gate is unit-testable
// without importing the (ajv-heavy) pipeline modules, and callers simply pass
// `process.env` (or their injected `environment`).

const { ROW_FAILED } = require("./line-state");

const LEVEL_REDUCED = "reduced";

/**
 * Build-side settled row statuses: the row left the working set, either
 * finished (ready/queued/sent) or terminally failed. These are exactly the
 * transitions a reduced feed still owes the operator — the row's OUTCOME —
 * as opposed to its in-flight hops (picked/qualified/mirrored/gate_passed).
 */
const ROW_SETTLED = Object.freeze(["ready", "queued", "sent", ...ROW_FAILED]);

/** "reduced" only when the env says so, exactly; anything else is "full". */
function lineTelemetryLevel(env = process.env) {
  const raw = String((env && env.GHOST_AGENCY_LINE_TELEMETRY) || "").trim().toLowerCase();
  return raw === LEVEL_REDUCED ? LEVEL_REDUCED : "full";
}

function isReduced(env = process.env) {
  return lineTelemetryLevel(env) === LEVEL_REDUCED;
}

/**
 * line_row_phase: under `reduced`, keep the per-phase oracle only when the
 * transition is terminal/error-shaped — the row settled (ready/queued/sent or
 * a failed state), the phase reported failure (`ok !== true` or an error
 * code), or the row parked on a build-retry (`retryable`). Happy-path hops
 * (picked→qualified→mirrored→gate_passed) are the dropped volume.
 */
function shouldLogRowPhase(env = process.env, phase = {}) {
  if (!isReduced(env)) return true;
  if (ROW_SETTLED.includes(String(phase.after_status || ""))) return true;
  if (phase.ok !== true) return true;
  if (phase.retryable === true) return true;
  return String(phase.error || "") !== "";
}

/**
 * line_worker_pass: under `reduced`, keep only passes that failed at least one
 * row. A clean pass (failed === 0) is the happy path the batch census already
 * summarizes durably; a pass with failures is the error signal.
 */
function shouldLogWorkerPass(env = process.env, pass = {}) {
  if (!isReduced(env)) return true;
  return Number(pass.failed) > 0;
}

/**
 * line_human_state: under `reduced`, keep the census only when it carries
 * terminal reasons — i.e. the batch HAS failures worth explaining. A healthy
 * batch's census line is pure volume.
 */
function shouldLogHumanState(env = process.env, state = {}) {
  if (!isReduced(env)) return true;
  const reasons = state.terminal_reasons;
  if (Array.isArray(reasons)) return reasons.length > 0;
  return Boolean(reasons);
}

/**
 * mirror_resume: under `reduced`, keep only unclean probes. Both call sites
 * log after `resume.found` was already established, so `probe.clean !== true`
 * is exactly the "resume refused, here is why" case that must stay visible.
 */
function shouldLogMirrorResume(env = process.env, probe = null) {
  if (!isReduced(env)) return true;
  return Boolean(probe) && probe.clean !== true;
}

/**
 * mirror_upload_batch: under `reduced`, keep only batches that did not account
 * for every file (a hard upload failure throws before this line, so a
 * shortfall here means something drifted — that is the diagnostic worth
 * paying an event for; a fully-accounted batch is the happy path).
 */
function shouldLogMirrorUploadBatch(env = process.env, batch = {}) {
  if (!isReduced(env)) return true;
  const files = Number(batch.files) || 0;
  return (Number(batch.uploaded) || 0) + (Number(batch.deduped) || 0) < files;
}

module.exports = {
  lineTelemetryLevel,
  shouldLogRowPhase,
  shouldLogWorkerPass,
  shouldLogHumanState,
  shouldLogMirrorResume,
  shouldLogMirrorUploadBatch,
};
