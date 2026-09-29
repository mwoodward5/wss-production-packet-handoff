"use strict";

// A verified hero rebuild wakes only the exact durable Line row that created
// it. The handle is opaque and PII-free. Missing/stale/ambiguous handles do
// nothing; the existing Line cron remains the recovery path.
const HERO_QUEUE_WAKE_TIMEOUT_MS = 750;
const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const ROW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,299}$/;

function heroQueueWakeEnabled(environment = process.env) {
  return !/^(0|false|off|no)$/i.test(String(environment?.GHOST_AGENCY_HERO_QUEUE_WAKE ?? "1").trim());
}

function normalizeLineHandle(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const batchId = String(value.batchId || value.batch_id || "").trim();
  const rowId = String(value.rowId || value.row_id || "").trim();
  return BATCH_ID_PATTERN.test(batchId) && ROW_ID_PATTERN.test(rowId)
    ? { batchId, rowId }
    : null;
}

async function settleBefore(work, timeoutMs = HERO_QUEUE_WAKE_TIMEOUT_MS) {
  let timer;
  const operation = Promise.resolve().then(work).then(
    (value) => ({ value }),
    () => ({ failed: true }),
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(1, Math.min(Number(timeoutMs) || HERO_QUEUE_WAKE_TIMEOUT_MS, HERO_QUEUE_WAKE_TIMEOUT_MS)));
  });
  const result = await Promise.race([operation, timeout]);
  clearTimeout(timer);
  return result;
}

function exactWaitingHeroRow(batch = {}, prospectId = "", lineHandle = null) {
  const handle = normalizeLineHandle(lineHandle);
  const id = String(prospectId || "").trim();
  if (!handle || !id || String(batch.batchId || "") !== handle.batchId) return null;
  if (!["building", "running"].includes(String(batch.status || ""))) return null;
  const matches = (batch.rows || []).filter((row) => (
    String(row?.rowId || row?.row_id || "").trim() === handle.rowId
    && String(row?.prospectId || row?.prospect_id || "").trim() === id
    && String(row?.status || "") === "qualified"
    && row?.heroRemaster?.required === true
    && row?.heroRemaster?.pending === true
  ));
  return matches.length === 1 ? matches[0] : null;
}

async function wakeLineForCompletedHero(prospectId, lineHandle, options = {}) {
  if (!heroQueueWakeEnabled(options.environment || process.env)) {
    return { accepted: false, recovery: "cron", reason: "hero_queue_wake_disabled" };
  }
  const id = String(prospectId || "").trim();
  const handle = normalizeLineHandle(lineHandle);
  if (!id) return { accepted: false, recovery: "cron", reason: "prospect_id_required" };
  if (!handle) return { accepted: false, recovery: "cron", reason: "hero_line_handle_required" };
  const persistence = options.persistence || require("./line-persistence");
  const enqueue = options.enqueueLineMessage || require("./line-queue").enqueueLineMessage;
  const loaded = await settleBefore(() => persistence.loadBatch(handle.batchId), options.timeoutMs);
  if (loaded.timedOut || loaded.failed || loaded.value?.ok !== true) {
    return { accepted: false, recovery: "cron", reason: "hero_batch_read_failed" };
  }
  const batch = loaded.value.batch;
  if (!exactWaitingHeroRow(batch, id, handle)) {
    return { accepted: false, recovery: "cron", reason: "hero_line_handle_mismatch" };
  }
  const message = {
    batchId: handle.batchId,
    phase: "hero",
    sequence: Math.max(Number(batch.version) || 0, 0),
    rowId: handle.rowId,
  };
  const published = await settleBefore(() => enqueue(message), options.timeoutMs);
  if (published.timedOut || published.failed || published.value?.accepted !== true) {
    return { accepted: false, recovery: "cron", reason: "hero_queue_wake_failed" };
  }
  return { accepted: true, ...message };
}

module.exports = {
  HERO_QUEUE_WAKE_TIMEOUT_MS,
  heroQueueWakeEnabled,
  normalizeLineHandle,
  exactWaitingHeroRow,
  wakeLineForCompletedHero,
};
