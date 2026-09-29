"use strict";

// Durable transport for the operator Line. The queue carries only an opaque
// batch handle and continuation coordinates; prospect facts stay in the
// authoritative store and are never copied into Vercel Queue messages.
const LINE_QUEUE_SCHEMA = "ghost.line.continuation.v1";
const LINE_QUEUE_TOPIC = "ghost-line-batches-v1";
const LINE_QUEUE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const LINE_QUEUE_VISIBILITY_SECONDS = 240;
const LINE_QUEUE_MAX_DELIVERIES = 8;
// Worker-active wake escalation, indexed by delivery count: 15s -> 30s -> 60s
// -> 120s (cap). The first retry stays at 15s so a just-released batch is
// picked up immediately; later overlaps back off so a busy batch no-ops at a
// falling rate instead of re-firing every 15 seconds forever.
const LINE_QUEUE_ACTIVE_RETRY_STEPS_SECONDS = [15, 30, 60, 120];
// Hard ceiling for worker-active retries before the wake is abandoned to the
// poison path (the rescue cron owns the batch after that). Env-overridable,
// clamped into [10, 200]; deliveryCount is the proxy for total retries since
// it is the only counter that reaches this layer.
const LINE_QUEUE_ACTIVE_RETRY_CAP_ENV = "GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP";
const LINE_QUEUE_ACTIVE_RETRY_CAP_DEFAULT = 40;
const LINE_QUEUE_ACTIVE_RETRY_CAP_MIN = 10;
const LINE_QUEUE_ACTIVE_RETRY_CAP_MAX = 200;
const LINE_QUEUE_ACTIVE_ABANDONED_CODE = "line_queue_worker_active_abandoned";
const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const ROW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,299}$/;
const PHASE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const SAFE_METADATA_PATTERN = /^[A-Za-z0-9_.:/-]{0,191}$/;

let defaultClient;

class PersistedLineQueuePoisonError extends Error {
  constructor() {
    super("line queue poison state persisted");
    this.name = "PersistedLineQueuePoisonError";
    this.code = "line_queue_poison_persisted";
  }
}

class LineWorkerActiveRetryError extends Error {
  constructor() {
    super("line worker is active; retry the queue delivery");
    this.name = "LineWorkerActiveRetryError";
    this.code = "line_queue_worker_active";
  }
}

class LineRowRetryNotDueError extends Error {
  constructor(afterSeconds) {
    super("line row retry is not due");
    this.name = "LineRowRetryNotDueError";
    this.code = "line_queue_row_retry_not_due";
    this.afterSeconds = boundedInteger(afterSeconds, 15, 1, 300);
  }
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function normalizeLineMessage(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("line_queue_message_invalid");
  }

  const suppliedSchema = String(input.schema || LINE_QUEUE_SCHEMA).trim();
  if (suppliedSchema !== LINE_QUEUE_SCHEMA) {
    throw new TypeError("line_queue_schema_unsupported");
  }

  const batchId = String(input.batchId || "").trim();
  if (!BATCH_ID_PATTERN.test(batchId)) {
    throw new TypeError("line_queue_batch_id_invalid");
  }

  const phase = String(input.phase || "run").trim().toLowerCase();
  if (!PHASE_PATTERN.test(phase)) {
    throw new TypeError("line_queue_phase_invalid");
  }

  const sequence = Number(input.sequence ?? 0);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TypeError("line_queue_sequence_invalid");
  }

  // Deliberately construct a new object instead of spreading input. This is
  // the PII boundary: email, phone, prospect data and request headers cannot
  // accidentally cross into the durable message.
  const rowId = String(input.rowId || input.row_id || "").trim();
  const rowScoped = phase === "hero" || phase === "row";
  if (rowScoped && !ROW_ID_PATTERN.test(rowId)) {
    throw new TypeError(phase === "hero" ? "line_queue_hero_row_id_invalid" : "line_queue_row_id_invalid");
  }
  if (!rowScoped && rowId) {
    throw new TypeError("line_queue_row_id_not_allowed");
  }
  return {
    schema: LINE_QUEUE_SCHEMA,
    batchId,
    phase,
    sequence,
    ...(rowScoped ? { rowId } : {}),
  };
}

function lineMessageIdempotencyKey(input) {
  const message = normalizeLineMessage(input);
  return `line:v1:${message.batchId}:${message.phase}:${message.sequence}${message.rowId ? `:${message.rowId}` : ""}`;
}

function loadQueueClient() {
  if (!defaultClient) {
    // Lazy so unit tests and non-queue routes do not initialize OIDC or the SDK.
    const { QueueClient } = require("@vercel/queue");
    defaultClient = new QueueClient();
  }
  return defaultClient;
}

async function enqueueLineMessage(input, dependencies = {}) {
  const message = normalizeLineMessage(input);
  const client = dependencies.client || loadQueueClient();
  if (!client || typeof client.send !== "function") {
    throw new TypeError("line_queue_client_invalid");
  }
  const requestedDelay = Number(input && input.delaySeconds);
  const delaySeconds = Number.isFinite(requestedDelay) && requestedDelay > 0
    ? Math.min(Math.ceil(requestedDelay), LINE_QUEUE_RETENTION_SECONDS)
    : 0;
  const result = await client.send(LINE_QUEUE_TOPIC, message, {
    idempotencyKey: lineMessageIdempotencyKey(message),
    retentionSeconds: LINE_QUEUE_RETENTION_SECONDS,
    ...(delaySeconds > 0 ? { delaySeconds } : {}),
  });
  return {
    accepted: true,
    messageId: result && result.messageId ? String(result.messageId) : null,
    message,
  };
}

function safeMetadata(metadata = {}) {
  const safeText = (value) => {
    const text = String(value || "").trim();
    return SAFE_METADATA_PATTERN.test(text) ? text : "";
  };
  const safeDate = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  return {
    messageId: safeText(metadata.messageId),
    deliveryCount: boundedInteger(metadata.deliveryCount, 1, 1, Number.MAX_SAFE_INTEGER),
    createdAt: safeDate(metadata.createdAt),
    expiresAt: safeDate(metadata.expiresAt),
    topicName: safeText(metadata.topicName),
    consumerGroup: safeText(metadata.consumerGroup),
    region: safeText(metadata.region),
  };
}

function safeFailureCode(error) {
  const code = String((error && error.code) || "").trim().toLowerCase();
  return /^[a-z][a-z0-9_.:-]{0,79}$/.test(code) ? code : "line_continuation_failed";
}

// Worker-active retries must never re-fire forever, even though they bypass
// maxDeliveries. deliveryCount stands in for the total (it counts every
// redelivery, and worker-active retries are the ones that keep it climbing);
// past the cap the wake is abandoned through the poison path and the */5
// rescue cron becomes the batch's backstop. Injected via dependencies for
// tests, else GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP, clamped to [10, 200].
function lineQueueActiveRetryCap(dependencies = {}, env = process.env) {
  const raw = String(dependencies.activeRetryCap ?? (env && env[LINE_QUEUE_ACTIVE_RETRY_CAP_ENV]) ?? "").trim();
  // Absent or non-numeric input must fall back to the default — never be
  // coerced (Number("") is 0, which would clamp to the minimum).
  if (!raw) return LINE_QUEUE_ACTIVE_RETRY_CAP_DEFAULT;
  const number = Number(raw);
  if (!Number.isFinite(number)) return LINE_QUEUE_ACTIVE_RETRY_CAP_DEFAULT;
  return Math.min(Math.max(Math.trunc(number), LINE_QUEUE_ACTIVE_RETRY_CAP_MIN), LINE_QUEUE_ACTIVE_RETRY_CAP_MAX);
}

function lineQueueRetry(error, metadata = {}) {
  if (error && error.code === "line_queue_poison_persisted") {
    return { acknowledge: true };
  }
  if (error && error.code === "line_queue_worker_active") {
    // A wake that overlaps the current pass is coordination, not provider
    // failure. Exponential backoff reached five minutes after a handful of
    // overlaps, so an already-checkpointed next phase sat idle long after the
    // worker released (and deployment-swap orphans took just as long to be
    // noticed). Keep the FIRST retry short and constant at 15s; the batch CAS
    // and row leases still guarantee that only one worker can advance a phase.
    // Sustained overlaps now escalate 15s -> 30s -> 60s -> 120s (cap) off
    // deliveryCount, so a busy batch fan-out (up to 50 row wakes) decays
    // instead of storming the consumer every 15 seconds.
    const deliveryCount = boundedInteger(metadata.deliveryCount, 1, 1, Number.MAX_SAFE_INTEGER);
    const step = Math.max(Math.min(deliveryCount, LINE_QUEUE_ACTIVE_RETRY_STEPS_SECONDS.length) - 1, 0);
    return { afterSeconds: LINE_QUEUE_ACTIVE_RETRY_STEPS_SECONDS[step] };
  }
  if (error && error.code === "line_queue_row_retry_not_due") {
    return { afterSeconds: boundedInteger(error.afterSeconds, 15, 1, 300) };
  }
  const deliveryCount = boundedInteger(metadata.deliveryCount, 1, 1, 62);
  return { afterSeconds: Math.min(300, 5 * (2 ** Math.min(deliveryCount, 6))) };
}

function createLineQueueConsumer(dependencies = {}) {
  const client = dependencies.client || loadQueueClient();
  const loadContinuation = dependencies.loadContinuation;
  if (!client || typeof client.handleNodeCallback !== "function") {
    throw new TypeError("line_queue_client_invalid");
  }
  if (typeof loadContinuation !== "function") {
    throw new TypeError("line_continuation_loader_invalid");
  }

  const processMessage = async (input, rawMetadata = {}) => {
    const message = normalizeLineMessage(input);
    const metadata = safeMetadata(rawMetadata);
    const continuation = loadContinuation();
    if (!continuation || typeof continuation.processLineMessage !== "function") {
      throw new TypeError("line_continuation_service_invalid");
    }

    try {
      const outcome = await continuation.processLineMessage(message, { metadata });
      if (outcome?.skipped === "worker_active") {
        // Returning normally acknowledges a Vercel Queue delivery. A packet
        // wake can arrive before the current worker releases its batch, so
        // turn only this transient result into a retry and leave the shared
        // continuation's cron/direct-call contract unchanged.
        throw new LineWorkerActiveRetryError();
      }
      if (outcome?.skipped === "row_retry_not_due") {
        throw new LineRowRetryNotDueError(outcome.retryDelaySeconds);
      }
      return outcome;
    } catch (error) {
      // An active worker is coordination, not poison. It must keep retrying at
      // every delivery count (lineQueueRetry escalates the delay) until the
      // batch releases — but never forever: past the worker-active retry cap
      // the wake is abandoned through the poison path instead, because the
      // batch CAS and row leases still guarantee single-writer safety and the
      // */5 rescue cron is the backstop, so nothing is lost.
      let terminalError = null;
      if (error instanceof LineWorkerActiveRetryError) {
        if (metadata.deliveryCount < lineQueueActiveRetryCap(dependencies)) throw error;
        // The active-retry cap is its own terminal condition: it replaces the
        // maxDeliveries gate for this error class (maxDeliveries stays the
        // ceiling for genuine provider failures below).
        terminalError = Object.assign(
          new Error("line queue worker-active retries abandoned"),
          { code: LINE_QUEUE_ACTIVE_ABANDONED_CODE },
        );
      } else if (error instanceof LineRowRetryNotDueError) {
        throw error;
      } else {
        const maxDeliveries = boundedInteger(
          dependencies.maxDeliveries,
          LINE_QUEUE_MAX_DELIVERIES,
          1,
          100,
        );
        if (metadata.deliveryCount < maxDeliveries) throw error;
        terminalError = error;
      }
      if (typeof continuation.markLineMessagePoison !== "function") throw error;

      // A poison message is acknowledged only after its terminal state is
      // durably recorded. If that write fails or the service omits the hook,
      // the original error is re-thrown and Vercel keeps retrying.
      let marked;
      try {
        marked = await continuation.markLineMessagePoison(message, {
          metadata,
          failureCode: safeFailureCode(terminalError),
        });
      } catch (_) {
        throw error;
      }
      if (!marked || marked.persisted !== true) throw error;
      throw new PersistedLineQueuePoisonError();
    }
  };

  return client.handleNodeCallback(processMessage, {
    visibilityTimeoutSeconds: LINE_QUEUE_VISIBILITY_SECONDS,
    retry: lineQueueRetry,
  });
}

module.exports = {
  LINE_QUEUE_ACTIVE_RETRY_STEPS_SECONDS,
  LINE_QUEUE_MAX_DELIVERIES,
  LINE_QUEUE_RETENTION_SECONDS,
  LINE_QUEUE_SCHEMA,
  LINE_QUEUE_TOPIC,
  LINE_QUEUE_VISIBILITY_SECONDS,
  LineWorkerActiveRetryError,
  LineRowRetryNotDueError,
  PersistedLineQueuePoisonError,
  createLineQueueConsumer,
  enqueueLineMessage,
  lineMessageIdempotencyKey,
  lineQueueActiveRetryCap,
  lineQueueRetry,
  normalizeLineMessage,
  safeMetadata,
};
