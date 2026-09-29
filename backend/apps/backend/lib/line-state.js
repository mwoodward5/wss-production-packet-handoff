"use strict";

const { boundedDetailText } = require("./detail-text");

/**
 * lib/line-state.js — the operator assembly line, as a state machine.
 *
 * ONE FLOW, and nothing else lives here:
 *
 *   pick/mine -> qualify -> mirror -> RENDER-GATE -> write preview_url
 *             -> queue email -> operator approves batch -> send
 *
 * Two invariants are enforced structurally rather than by convention, because
 * this system has repeatedly shipped defects that a convention would have
 * allowed:
 *
 *   1. THE RENDER GATE IS NOT SKIPPABLE. `queued` is reachable from exactly one
 *      predecessor state, `gate_passed`, and advanceRow() is the only writer.
 *      There is no argument that bypasses it — a row whose gate did not run is
 *      indistinguishable, to this module, from a row whose gate failed.
 *
 *   2. A SEND REQUIRES AN EXPLICIT PER-BATCH OPERATOR APPROVAL. sendableRows()
 *      returns [] for any batch that is not `approved`, and approveBatch()
 *      demands the operator echo the batch id back. No loop can reach a
 *      prospect address without a human having typed that.
 */

/** Row lifecycle. Index order is progress order; you may only move forward. */
const ROW_STATES = Object.freeze([
  "picked",       // mined or selected from the store
  "qualified",    // passed build-qualification: composite at/under C+, website at/under its ceiling
  "mirrored",     // a mirror was built and has a candidate URL
  "gate_passed",  // the RENDER GATE proved all eight facts on the live DOM
  "queued",       // preview_url written, email drafted and queued
  "sent",         // delivered, after explicit batch approval
]);

/** Terminal failure states. A row here is finished and is never sent. */
const ROW_READY = "ready";
const ROW_FAILED = Object.freeze(["rejected", "gate_failed", "error"]);

const BATCH_STATES = Object.freeze([
  "queued",             // accepted durably; the server worker has not picked yet
  "building",           // resumable build work exists, with no worker assumed alive
  "running",            // one or more rows currently hold a worker lease
  "awaiting_approval",
  "approved",
  "sending",
  "done",
  "halted",
]);

/** States a replacement worker may continue without repeating an earlier phase. */
const ROW_RESUMABLE = Object.freeze(["picked", "qualified", "mirrored", "gate_passed"]);

function stateIndex(state) {
  return ROW_STATES.indexOf(String(state || ""));
}

function isFailed(state) {
  return ROW_FAILED.includes(String(state || ""));
}

function hasPassingGate(row) {
  return Boolean(row && row.gate && row.gate.pass === true);
}

function strandedReadyRow(row) {
  return Boolean(row) && row.status === ROW_READY && !hasPassingGate(row);
}

function hasStrandedReadyRows(batch) {
  return (batch && Array.isArray(batch.rows) ? batch.rows : []).some(strandedReadyRow);
}

function newRow(input = {}) {
  return {
    prospectId: String(input.prospectId || input.prospect_id || "").trim(),
    businessName: String(input.businessName || input.business_name || "").trim(),
    city: String(input.city || "").trim(),
    state: String(input.state || "").trim(),
    vertical: String(input.vertical || input.industry || "").trim(),
    email: String(input.email || "").trim(),
    status: "picked",
    previewUrl: "",
    gate: null,          // the full eight-fact verdict, once it has run
    failedFacts: [],     // WHICH fact failed — the operator's answer to "why"
    reason: "",
    updatedAt: input.now || new Date().toISOString(),
    history: [{ status: "picked", at: input.now || new Date().toISOString() }],
  };
}

/**
 * advanceRow — the ONLY legal way a row changes state.
 *
 * @param {object} row
 * @param {string} next        target state
 * @param {object} patch       { previewUrl, gate, reason, now }
 * @returns {{ok:boolean, row:object, error?:string}}
 */
function advanceRow(row, next, patch = {}) {
  const now = patch.now || new Date().toISOString();
  const target = String(next || "");

  if (isFailed(row.status)) {
    return { ok: false, row, error: `row_already_terminal:${row.status}` };
  }

  if (target === ROW_READY) {
    if (row.status !== "gate_passed") return { ok: false, row, error: `illegal_transition:${row.status}->${target}` };
    if (!row.gate || row.gate.pass !== true) return { ok: false, row, error: "render_gate_not_passed" };
    if (!String(patch.previewUrl || row.previewUrl || "").trim()) return { ok: false, row, error: "no_preview_url_to_write" };
    const updated = { ...row, status: ROW_READY, previewUrl: String(patch.previewUrl || row.previewUrl || ""), updatedAt: now,
      history: row.history.concat([{ status: ROW_READY, at: now }]) };
    return { ok: true, row: updated };
  }

  if (isFailed(target)) {
    const updated = {
      ...row,
      status: target,
      reason: boundedDetailText(patch.reason || row.reason || ""),
      gate: patch.gate || row.gate,
      failedFacts: patch.gate ? patch.gate.failed || [] : row.failedFacts,
      updatedAt: now,
      history: row.history.concat([{ status: target, at: now, reason: boundedDetailText(patch.reason || "") }]),
    };
    return { ok: true, row: updated };
  }

  const from = stateIndex(row.status);
  const to = stateIndex(target);
  if (to < 0) return { ok: false, row, error: `unknown_state:${target}` };
  if (to !== from + 1) {
    // Skipping a state is the bug this module exists to make impossible.
    return { ok: false, row, error: `illegal_transition:${row.status}->${target}` };
  }

  // THE GATE. `queued` is reachable only from a gate that actually PASSED, and
  // the passing verdict has to be attached to the row as evidence.
  if (target === "queued") {
    if (!row.gate || row.gate.pass !== true) {
      return { ok: false, row, error: "render_gate_not_passed" };
    }
    if (!String(patch.previewUrl || row.previewUrl || "").trim()) {
      return { ok: false, row, error: "no_preview_url_to_write" };
    }
  }
  if (target === "gate_passed") {
    if (!patch.gate || patch.gate.pass !== true) {
      return { ok: false, row, error: "render_gate_did_not_pass" };
    }
  }

  const updated = {
    ...row,
    status: target,
    previewUrl: String(patch.previewUrl || row.previewUrl || ""),
    gate: patch.gate || row.gate,
    failedFacts: patch.gate ? patch.gate.failed || [] : row.failedFacts,
    reason: patch.reason !== undefined ? boundedDetailText(patch.reason) : row.reason,
    updatedAt: now,
    history: row.history.concat([{ status: target, at: now }]),
  };
  return { ok: true, row: updated };
}

/**
 * applyGate — run a gate verdict onto a mirrored row. A FAIL blocks the write
 * AND the queue for that row, and records WHICH fact failed.
 */
function applyGate(row, verdict, { now } = {}) {
  if (row.status !== "mirrored") {
    return { ok: false, row, error: `gate_requires_mirrored_row:${row.status}` };
  }
  if (!verdict || typeof verdict.pass !== "boolean") {
    return advanceRow(row, "gate_failed", { reason: "render gate returned no verdict", now });
  }
  if (verdict.pass !== true) {
    const failed = verdict.failed || [];
    return advanceRow(row, "gate_failed", {
      gate: verdict,
      reason: verdict.blockedBy || `failed facts: ${failed.join(", ")}`,
      now,
    });
  }
  return advanceRow(row, "gate_passed", { gate: verdict, now });
}

function newBatch(input = {}) {
  const now = input.now || new Date().toISOString();
  return {
    batchId: String(input.batchId || "").trim(),
    lane: input.lane === "live" ? "live" : "sandbox",
    target: String(input.target || ""),
    requested: Number(input.requested) || 0,
    status: BATCH_STATES.includes(input.status) ? input.status : "running",
    // Legacy callers did not record pick state. Treat an omitted value as
    // complete so old durable snapshots remain approvable; the new async start
    // path explicitly creates `pending` and cannot settle until the worker has
    // durably written the selected rows.
    pickState: input.pickState === "pending" || input.pickState === "picking"
      ? input.pickState
      : "complete",
    startedAt: now,
    mineFunnel: input.mineFunnel || {},
    approval: null,
    rows: [],
  };
}

/** A batch is ready for the operator once no row is still moving. */
function batchSettled(batch) {
  if (batch && (batch.pickState === "pending" || batch.pickState === "picking")) return false;
  return (batch.rows || []).every((r) => (
    (r.status === ROW_READY && !strandedReadyRow(r))
    || r.status === "queued"
    || isFailed(r.status)
    || r.status === "sent"
  ));
}

function rowResumable(row) {
  return Boolean(row) && (ROW_RESUMABLE.includes(String(row.status || "")) || strandedReadyRow(row));
}

/** Derive the honest build-side state from durable rows, never from a timer. */
function deriveBuildStatus(batch, { activeLeases = 0 } = {}) {
  if (!batch) return "halted";
  if (batch.status === "halted") return "halted";
  if (hasStrandedReadyRows(batch) && ["awaiting_approval", "done"].includes(String(batch.status || ""))) {
    return activeLeases > 0 ? "running" : "building";
  }
  if (batch.status === "approved" || batch.status === "sending" || batch.status === "done") return batch.status;
  if (activeLeases > 0) return "running";
  if (!batchSettled(batch)) return "building";
  const counts = batchCounts(batch);
  return counts.queued > 0 ? "awaiting_approval" : "done";
}

function batchCounts(batch) {
  const counts = { total: (batch.rows || []).length, ready: 0, queued: 0, failed: 0, sent: 0, working: 0 };
  for (const row of batch.rows || []) {
    if (row.status === ROW_READY) counts.ready += 1;
    else if (row.status === "queued") counts.queued += 1;
    else if (row.status === "sent") counts.sent += 1;
    else if (isFailed(row.status)) counts.failed += 1;
    else counts.working += 1;
  }
  return counts;
}

/**
 * approveBatch — the human gate. Requires:
 *   · the batch to be settled and awaiting approval,
 *   · the operator to echo the exact batch id (typed in the UI),
 *   · at least one queued row.
 * Approval is recorded with who and when, and it approves THAT batch only.
 */
function approveBatch(batch, { typedBatchId, actor = "operator", now } = {}) {
  const at = now || new Date().toISOString();
  if (!batch) return { ok: false, error: "no_batch" };
  if (batch.status === "halted") {
    return { ok: false, batch, error: "batch_halted" };
  }
  if (batch.status === "approved" || batch.status === "sending" || batch.status === "done") {
    return { ok: false, batch, error: `batch_already_${batch.status}` };
  }
  if (!batchSettled(batch)) return { ok: false, batch, error: "batch_still_running" };
  if (String(typedBatchId || "").trim() !== batch.batchId) {
    return { ok: false, batch, error: "approval_confirmation_mismatch" };
  }
  const counts = batchCounts(batch);
  if (counts.queued < 1) return { ok: false, batch, error: "nothing_passed_the_render_gate" };
  return {
    ok: true,
    batch: {
      ...batch,
      status: "approved",
      approval: { actor, at, approvedRows: counts.queued, typedBatchId: batch.batchId },
    },
  };
}

/**
 * Legacy snapshots predate the canonical Line tables, so their approval proof
 * lives on the batch itself. Status alone is not proof: require the timestamp,
 * the exact echoed batch id, and a positive durable row count that
 * approveBatch() stamps together before a send may mutate anything.
 */
function hasDurableLegacyApproval(batch) {
  const approval = batch && batch.approval;
  if (!approval || typeof approval !== "object") return false;
  if (!Number.isFinite(Date.parse(String(approval.at || "")))) return false;
  if (String(approval.typedBatchId || "") !== String(batch.batchId || "")) return false;
  const approvedRows = Number(approval.approvedRows);
  return Number.isInteger(approvedRows) && approvedRows > 0;
}

/**
 * sendableRows — the ONLY source of send targets.
 * Returns [] unless the operator approved THIS batch. A row that never reached
 * `queued` is not here, so a gate failure is also a send block.
 */
function sendableRows(batch) {
  if (!batch || batch.status !== "approved" || !hasDurableLegacyApproval(batch)) return [];
  return (batch.rows || []).filter((r) => r.status === "queued");
}

/**
 * assertSendAuthorized — belt and braces for the send path itself, so a future
 * caller that forgets sendableRows() still cannot reach a prospect.
 */
function assertSendAuthorized(batch) {
  if (!batch) throw new Error("send_blocked:no_batch");
  if (batch.status !== "approved") throw new Error(`send_blocked:batch_status_${batch.status}`);
  if (!batch.approval || !batch.approval.at) throw new Error("send_blocked:no_operator_approval");
  if (!Number.isFinite(Date.parse(String(batch.approval.at)))) {
    throw new Error("send_blocked:invalid_approval_timestamp");
  }
  if (String(batch.approval.typedBatchId || "") !== String(batch.batchId || "")) {
    throw new Error("send_blocked:approval_batch_mismatch");
  }
  const approvedRows = Number(batch.approval.approvedRows);
  if (!Number.isInteger(approvedRows) || approvedRows < 1) {
    throw new Error("send_blocked:no_approved_rows");
  }
  const ungated = (batch.rows || []).filter((r) => r.status === "queued" && (!r.gate || r.gate.pass !== true));
  if (ungated.length) throw new Error(`send_blocked:${ungated.length}_queued_rows_without_a_passing_gate`);
  return true;
}

module.exports = {
  ROW_STATES,
  ROW_READY,
  ROW_FAILED,
  ROW_RESUMABLE,
  BATCH_STATES,
  hasPassingGate,
  strandedReadyRow,
  hasStrandedReadyRows,
  newRow,
  newBatch,
  advanceRow,
  applyGate,
  approveBatch,
  batchSettled,
  batchCounts,
  deriveBuildStatus,
  rowResumable,
  sendableRows,
  assertSendAuthorized,
  isFailed,
};
