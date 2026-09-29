"use strict";

// A LeadMiner delivery only wakes an existing Practice batch. The durable
// prospect rows remain the source of truth; the queue receives this opaque
// continuation handle and nothing from the webhook payload.
const PACKET_QUEUE_WAKE_TIMEOUT_MS = 750;

function packetQueueWakeEnabled(environment = process.env) {
  return String(environment?.GHOST_AGENCY_PACKET_QUEUE_WAKE ?? "1").trim() !== "0";
}

function batchStamp(batch) {
  for (const value of [batch?.startedAt, batch?.createdAt, batch?.updatedAt]) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function newestActivePracticeBatch(batches = []) {
  return batches
    .filter((batch) => batch?.lane === "sandbox" && ["building", "running"].includes(batch?.status))
    .sort((left, right) => batchStamp(right) - batchStamp(left))[0] || null;
}

function timeoutBudget(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PACKET_QUEUE_WAKE_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(parsed), 1), PACKET_QUEUE_WAKE_TIMEOUT_MS);
}

async function settleBefore(promiseFactory, deadlineAt) {
  const remaining = Math.max(deadlineAt - Date.now(), 0);
  if (remaining < 1) return { timedOut: true };

  let timer;
  const operation = Promise.resolve().then(promiseFactory);
  // Keep a late rejection handled after the timeout wins the race.
  const settled = operation.then(
    (value) => ({ value }),
    () => ({ failed: true }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), remaining);
  });
  const result = await Promise.race([settled, timeout]);
  clearTimeout(timer);
  return result;
}

function cronRecovery(reason) {
  return { accepted: false, recovery: "cron", reason };
}

async function wakeNewestBuildingPracticeBatch(options = {}) {
  const environment = options.environment || process.env;
  if (!packetQueueWakeEnabled(environment)) {
    return cronRecovery("packet_queue_wake_disabled");
  }

  // Lazy imports keep webhook verification and non-queue routes from starting
  // the Queue SDK or its OIDC setup.
  const persistence = options.persistence || require("./line-persistence");
  const enqueueLineMessage = options.enqueueLineMessage || require("./line-queue").enqueueLineMessage;
  const deadlineAt = Date.now() + timeoutBudget(options.timeoutMs);

  const listed = await settleBefore(() => persistence.listBatches({
    statuses: ["building", "running"],
    limit: 25,
    includeRows: false,
    order: "updated_at.desc",
  }), deadlineAt);
  if (listed.timedOut) return cronRecovery("line_batch_list_timeout");
  if (listed.failed || listed.value?.ok !== true) return cronRecovery("line_batch_list_failed");

  const batch = newestActivePracticeBatch(listed.value.batches);
  if (!batch) return cronRecovery("no_active_practice_batch");
  // Match the human ownership layer: the newest Practice batch owns the
  // factory whether it is waiting or already running. A packet can land after
  // the active worker took its pick snapshot; publishing the running batch's
  // current version gives that packet an event-driven continuation instead of
  // leaving it for the */2 rescue cron.
  const sequence = Math.max(Number(batch.version) || 0, 0);
  const message = { batchId: batch.batchId, phase: "run", sequence };
  const enqueued = await settleBefore(() => enqueueLineMessage(message), deadlineAt);
  if (enqueued.timedOut) return cronRecovery("line_queue_wake_timeout");
  if (enqueued.failed || enqueued.value?.accepted !== true) return cronRecovery("line_queue_wake_failed");

  return {
    accepted: true,
    batchId: message.batchId,
    phase: message.phase,
    sequence: message.sequence,
  };
}

module.exports = {
  PACKET_QUEUE_WAKE_TIMEOUT_MS,
  batchStamp,
  newestActivePracticeBatch,
  packetQueueWakeEnabled,
  wakeNewestBuildingPracticeBatch,
};
