"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  LINE_QUEUE_RETENTION_SECONDS,
  LINE_QUEUE_SCHEMA,
  LINE_QUEUE_TOPIC,
  LINE_QUEUE_VISIBILITY_SECONDS,
  LineWorkerActiveRetryError,
  createLineQueueConsumer,
  enqueueLineMessage,
  lineMessageIdempotencyKey,
  lineQueueRetry,
  normalizeLineMessage,
} = require("../lib/line-queue");
const {
  createRunLineBatchesHandler,
  safeRescueSummary,
} = require("../api/cron/run-line-batches");

function consumerHarness() {
  const harness = { processMessage: null, options: null };
  harness.client = {
    handleNodeCallback(processMessage, options) {
      harness.processMessage = processMessage;
      harness.options = options;
      return async function fakeNodeCallback(req, res) {
        return processMessage(req.body, req.metadata, res);
      };
    },
  };
  return harness;
}

test("Line queue payload is an exact PII-free continuation envelope", () => {
  const message = normalizeLineMessage({
    batchId: "line_2026-08-14:abc",
    phase: "BUILD",
    sequence: 7,
    email: "must-not-cross@example.test",
    prospect: { phone: "+15555550123" },
    headers: { authorization: "secret" },
  });

  assert.deepEqual(message, {
    schema: LINE_QUEUE_SCHEMA,
    batchId: "line_2026-08-14:abc",
    phase: "build",
    sequence: 7,
  });
  assert.deepEqual(Object.keys(message), ["schema", "batchId", "phase", "sequence"]);
  assert.doesNotMatch(JSON.stringify(message), /example|phone|secret/i);
});

test("Line queue rejects malformed coordinates before publishing", async () => {
  const client = { send: async () => assert.fail("send must not run") };
  await assert.rejects(
    enqueueLineMessage({ batchId: "contains an email@example.test" }, { client }),
    /line_queue_batch_id_invalid/,
  );
  await assert.rejects(
    enqueueLineMessage({ batchId: "line_1", phase: "../../escape" }, { client }),
    /line_queue_phase_invalid/,
  );
  await assert.rejects(
    enqueueLineMessage({ batchId: "line_1", sequence: -1 }, { client }),
    /line_queue_sequence_invalid/,
  );
  assert.throws(
    () => normalizeLineMessage({ schema: "ghost.line.continuation.v0", batchId: "line_1" }),
    /line_queue_schema_unsupported/,
  );
  assert.throws(
    () => normalizeLineMessage({ batchId: "line_1", phase: "hero", sequence: 1 }),
    /line_queue_hero_row_id_invalid/,
  );
  assert.throws(
    () => normalizeLineMessage({ batchId: "line_1", phase: "row", sequence: 1 }),
    /line_queue_row_id_invalid/,
  );
  assert.throws(
    () => normalizeLineMessage({ batchId: "line_1", phase: "run", sequence: 1, rowId: "line_1:0" }),
    /line_queue_row_id_not_allowed/,
  );
});

test("row continuation carries only exact opaque row coordinates", () => {
  const first = {
    batchId: "line_batch_parallel",
    phase: "row",
    sequence: 12,
    rowId: "line_batch_parallel:4",
    businessName: "must not cross",
    email: "must-not-cross@example.test",
  };
  const second = { ...first, rowId: "line_batch_parallel:5" };
  assert.deepEqual(normalizeLineMessage(first), {
    schema: LINE_QUEUE_SCHEMA,
    batchId: "line_batch_parallel",
    phase: "row",
    sequence: 12,
    rowId: "line_batch_parallel:4",
  });
  assert.doesNotMatch(JSON.stringify(normalizeLineMessage(first)), /business|example|email/i);
  assert.notEqual(lineMessageIdempotencyKey(first), lineMessageIdempotencyKey(second));
});

test("hero continuation keys the exact opaque row and strips all prospect facts", () => {
  const first = {
    batchId: "line_batch_hero",
    phase: "hero",
    sequence: 9,
    rowId: "line_batch_hero:1",
    prospectId: "must-not-cross",
    email: "must-not-cross@example.test",
    phone: "+15555550123",
  };
  const second = { ...first, rowId: "line_batch_hero:2" };
  const normalized = normalizeLineMessage(first);
  assert.deepEqual(normalized, {
    schema: LINE_QUEUE_SCHEMA,
    batchId: "line_batch_hero",
    phase: "hero",
    sequence: 9,
    rowId: "line_batch_hero:1",
  });
  assert.doesNotMatch(JSON.stringify(normalized), /prospect|example|phone|555/i);
  assert.notEqual(lineMessageIdempotencyKey(first), lineMessageIdempotencyKey(second));
  assert.equal(lineMessageIdempotencyKey(first), lineMessageIdempotencyKey({ ...first }));
});

test("Line producer uses a stable idempotency key and seven-day retention", async () => {
  const calls = [];
  const client = {
    async send(...args) {
      calls.push(args);
      return { messageId: `msg-${calls.length}` };
    },
  };
  const input = {
    batchId: "line_batch_42",
    phase: "run",
    sequence: 3,
    email: "drop-me@example.test",
  };

  await enqueueLineMessage(input, { client });
  await enqueueLineMessage(input, { client });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], LINE_QUEUE_TOPIC);
  assert.deepEqual(calls[0][1], {
    schema: LINE_QUEUE_SCHEMA,
    batchId: "line_batch_42",
    phase: "run",
    sequence: 3,
  });
  assert.deepEqual(calls[0][2], {
    idempotencyKey: lineMessageIdempotencyKey(input),
    retentionSeconds: LINE_QUEUE_RETENTION_SECONDS,
  });
  assert.equal(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
  assert.equal(LINE_QUEUE_RETENTION_SECONDS, 604800);
});

test("delayed continuation stays out of the payload and reaches QueueClient send options", async () => {
  const calls = [];
  const client = {
    async send(...args) {
      calls.push(args);
      return { messageId: "msg-delayed" };
    },
  };
  const input = {
    batchId: "line_batch_delayed",
    phase: "run",
    sequence: 12,
    delaySeconds: 31,
  };

  await enqueueLineMessage(input, { client });

  assert.deepEqual(calls[0][1], {
    schema: LINE_QUEUE_SCHEMA,
    batchId: "line_batch_delayed",
    phase: "run",
    sequence: 12,
  });
  assert.deepEqual(calls[0][2], {
    idempotencyKey: lineMessageIdempotencyKey(input),
    retentionSeconds: LINE_QUEUE_RETENTION_SECONDS,
    delaySeconds: 31,
  });
});

test("CommonJS consumer lazily delegates to processLineMessage with safe metadata", async () => {
  const harness = consumerHarness();
  let loads = 0;
  let received;
  const handler = createLineQueueConsumer({
    client: harness.client,
    loadContinuation() {
      loads += 1;
      return {
        async processLineMessage(message, context) {
          received = { message, context };
          return { ok: true };
        },
      };
    },
  });

  assert.equal(typeof handler, "function");
  assert.equal(loads, 0, "continuation service must stay lazy at cold start");
  assert.equal(harness.options.visibilityTimeoutSeconds, LINE_QUEUE_VISIBILITY_SECONDS);
  assert.equal(typeof harness.options.retry, "function");

  await harness.processMessage(
    { batchId: "line_77", phase: "run", sequence: 0, email: "drop@example.test" },
    {
      messageId: "msg_77",
      deliveryCount: 2,
      createdAt: new Date("2026-08-14T12:00:00.000Z"),
      expiresAt: new Date("2026-08-21T12:00:00.000Z"),
      topicName: LINE_QUEUE_TOPIC,
      consumerGroup: "line-batch-js",
      region: "iad1",
      headers: { authorization: "do-not-forward" },
    },
  );

  assert.equal(loads, 1);
  assert.deepEqual(received.message, {
    schema: LINE_QUEUE_SCHEMA,
    batchId: "line_77",
    phase: "run",
    sequence: 0,
  });
  assert.equal(received.context.metadata.deliveryCount, 2);
  assert.equal(received.context.metadata.region, "iad1");
  assert.equal("headers" in received.context.metadata, false);
});

test("worker-active delivery retries without poison, then succeeds after the batch releases", async () => {
  const harness = consumerHarness();
  let attempts = 0;
  let poisonCalls = 0;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 2,
    loadContinuation: () => ({
      processLineMessage: async () => {
        attempts += 1;
        return attempts === 1
          ? { ok: true, skipped: "worker_active" }
          : { ok: true, status: "building", processed: 1 };
      },
      markLineMessagePoison: async () => {
        poisonCalls += 1;
        return { persisted: true };
      },
    }),
  });

  let activeError;
  try {
    await harness.processMessage(
      { batchId: "line_running_wake", phase: "run", sequence: 9 },
      { messageId: "msg_running_wake", deliveryCount: 8, region: "iad1" },
    );
  } catch (error) {
    activeError = error;
  }

  assert.equal(activeError?.code, "line_queue_worker_active");
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 8 }), { afterSeconds: 120 });
  assert.equal(poisonCalls, 0, "worker-active is transient even beyond the poison delivery ceiling");

  const eventual = await harness.processMessage(
    { batchId: "line_running_wake", phase: "run", sequence: 9 },
    { messageId: "msg_running_wake", deliveryCount: 9, region: "iad1" },
  );
  assert.deepEqual(eventual, { ok: true, status: "building", processed: 1 });
  assert.equal(attempts, 2);
  assert.equal(poisonCalls, 0);
});

test("worker-active retry delay escalates by delivery count and caps at 120s", () => {
  const activeError = new LineWorkerActiveRetryError();
  // First retry stays at the original short coordination window; sustained
  // overlaps then back off 15 -> 30 -> 60 -> 120 (cap) so a busy batch fan-out
  // decays instead of re-firing every 15 seconds.
  assert.deepEqual(lineQueueRetry(activeError, {}), { afterSeconds: 15 });
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 1 }), { afterSeconds: 15 });
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 2 }), { afterSeconds: 30 });
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 3 }), { afterSeconds: 60 });
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 4 }), { afterSeconds: 120 });
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 5 }), { afterSeconds: 120 });
  assert.deepEqual(lineQueueRetry(activeError, { deliveryCount: 500 }), { afterSeconds: 120 });
});

test("worker-active stays transient below the active cap even far past maxDeliveries", async () => {
  const harness = consumerHarness();
  let poisonCalls = 0;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 2,
    activeRetryCap: 40,
    loadContinuation: () => ({
      processLineMessage: async () => ({ ok: true, skipped: "worker_active" }),
      markLineMessagePoison: async () => {
        poisonCalls += 1;
        return { persisted: true };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_active_storm", phase: "run", sequence: 4 },
      { messageId: "msg_active_storm", deliveryCount: 39, region: "iad1" },
    );
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.code, "line_queue_worker_active");
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 39 }), { afterSeconds: 120 });
  assert.equal(poisonCalls, 0);
});

test("worker-active cap abandons the wake through the poison path with the abandoned code", async () => {
  const harness = consumerHarness();
  let poisonCalls = 0;
  let poisonContext;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 2,
    activeRetryCap: 10,
    loadContinuation: () => ({
      processLineMessage: async () => ({ ok: true, skipped: "worker_active" }),
      markLineMessagePoison: async (_message, context) => {
        poisonCalls += 1;
        poisonContext = context;
        return { persisted: true };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_active_cap", phase: "run", sequence: 4 },
      { messageId: "msg_active_cap", deliveryCount: 10, region: "iad1" },
    );
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.code, "line_queue_poison_persisted");
  assert.equal(poisonCalls, 1);
  assert.equal(poisonContext.failureCode, "line_queue_worker_active_abandoned");
  assert.equal(poisonContext.metadata.deliveryCount, 10);
  assert.equal(poisonContext.metadata.messageId, "msg_active_cap");
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 10 }), { acknowledge: true });
});

test("worker-active cap is a hard ceiling even when maxDeliveries is raised past it", async () => {
  const harness = consumerHarness();
  let poisonCalls = 0;
  let failureCode;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 100,
    activeRetryCap: 10,
    loadContinuation: () => ({
      processLineMessage: async () => ({ ok: true, skipped: "worker_active" }),
      markLineMessagePoison: async (_message, context) => {
        poisonCalls += 1;
        failureCode = context.failureCode;
        return { persisted: true };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_active_hard_cap", phase: "run", sequence: 4 },
      { messageId: "msg_active_hard_cap", deliveryCount: 10, region: "iad1" },
    );
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.code, "line_queue_poison_persisted");
  assert.equal(poisonCalls, 1);
  assert.equal(failureCode, "line_queue_worker_active_abandoned");
});

test("unpersisted worker-active abandonment keeps the original retry error", async () => {
  const harness = consumerHarness();
  let poisonCalls = 0;
  createLineQueueConsumer({
    client: harness.client,
    activeRetryCap: 10,
    loadContinuation: () => ({
      processLineMessage: async () => ({ ok: true, skipped: "worker_active" }),
      markLineMessagePoison: async () => {
        poisonCalls += 1;
        return { persisted: false };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_active_unpersisted", phase: "run", sequence: 4 },
      { messageId: "msg_active_unpersisted", deliveryCount: 12, region: "iad1" },
    );
  } catch (error) {
    thrown = error;
  }

  // Terminal state never durably recorded: fall back to the worker-active
  // retry error (escalated delay) so Vercel keeps retrying, exactly like the
  // generic poison path.
  assert.equal(thrown?.code, "line_queue_worker_active");
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 12 }), { afterSeconds: 120 });
  assert.equal(poisonCalls, 1);
});

test("worker-active cap env override is clamped into range", async (t) => {
  const before = process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP;
  process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP = "500";
  t.after(() => {
    if (before === undefined) delete process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP;
    else process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP = before;
  });

  const harness = consumerHarness();
  let poisonCalls = 0;
  const continuation = {
    processLineMessage: async () => ({ ok: true, skipped: "worker_active" }),
    markLineMessagePoison: async () => {
      poisonCalls += 1;
      return { persisted: true };
    },
  };
  createLineQueueConsumer({
    client: harness.client,
    loadContinuation: () => continuation,
  });

  // 500 clamps to 200, so 150 is still transient coordination.
  let below;
  try {
    await harness.processMessage(
      { batchId: "line_cap_env", phase: "run", sequence: 1 },
      { messageId: "msg_cap_env", deliveryCount: 150 },
    );
  } catch (error) {
    below = error;
  }
  assert.equal(below?.code, "line_queue_worker_active");
  assert.equal(poisonCalls, 0);

  let atCap;
  try {
    await harness.processMessage(
      { batchId: "line_cap_env", phase: "run", sequence: 1 },
      { messageId: "msg_cap_env", deliveryCount: 200 },
    );
  } catch (error) {
    atCap = error;
  }
  assert.equal(atCap?.code, "line_queue_poison_persisted");
  assert.equal(poisonCalls, 1);
});

test("worker-active cap falls back to the default when the env value is unset or garbage", async (t) => {
  const before = process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP;
  delete process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP;
  t.after(() => {
    if (before === undefined) delete process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP;
    else process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP = before;
  });

  const harness = consumerHarness();
  let poisonCalls = 0;
  const continuation = {
    processLineMessage: async () => ({ ok: true, skipped: "worker_active" }),
    markLineMessagePoison: async () => {
      poisonCalls += 1;
      return { persisted: true };
    },
  };
  createLineQueueConsumer({
    client: harness.client,
    loadContinuation: () => continuation,
  });

  // Unset env must mean the DEFAULT cap (40), never the clamp minimum — an
  // empty-string coercion to 0 would otherwise abandon wakes at 10.
  let below;
  try {
    await harness.processMessage(
      { batchId: "line_cap_default", phase: "run", sequence: 1 },
      { messageId: "msg_cap_default", deliveryCount: 39 },
    );
  } catch (error) {
    below = error;
  }
  assert.equal(below?.code, "line_queue_worker_active");
  assert.equal(poisonCalls, 0);

  let atCap;
  try {
    await harness.processMessage(
      { batchId: "line_cap_default", phase: "run", sequence: 1 },
      { messageId: "msg_cap_default", deliveryCount: 40 },
    );
  } catch (error) {
    atCap = error;
  }
  assert.equal(atCap?.code, "line_queue_poison_persisted");
  assert.equal(poisonCalls, 1);

  // Garbage env also means the default, in BOTH directions.
  process.env.GHOST_AGENCY_LINE_ACTIVE_RETRY_CAP = "not-a-number";
  let garbage;
  try {
    await harness.processMessage(
      { batchId: "line_cap_default", phase: "run", sequence: 1 },
      { messageId: "msg_cap_default", deliveryCount: 40 },
    );
  } catch (error) {
    garbage = error;
  }
  assert.equal(garbage?.code, "line_queue_poison_persisted");
  assert.equal(poisonCalls, 2);
});

test("normal errors below maxDeliveries keep their original retry behavior", async () => {
  const harness = consumerHarness();
  const original = Object.assign(new Error("provider blip"), { code: "UPSTREAM_503" });
  let poisonCalls = 0;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 3,
    activeRetryCap: 10,
    loadContinuation: () => ({
      processLineMessage: async () => { throw original; },
      markLineMessagePoison: async () => {
        poisonCalls += 1;
        return { persisted: true };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_normal_error", phase: "run", sequence: 2 },
      { messageId: "msg_normal_error", deliveryCount: 2, region: "iad1" },
    );
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown, original);
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 2 }), { afterSeconds: 20 });
  assert.equal(poisonCalls, 0);
});

test("a claimed row lease retries at its due time without becoming poison", async () => {
  const harness = consumerHarness();
  let poisonCalls = 0;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 2,
    loadContinuation: () => ({
      processLineMessage: async () => ({
        ok: true,
        skipped: "row_retry_not_due",
        retryDelaySeconds: 37,
      }),
      markLineMessagePoison: async () => {
        poisonCalls += 1;
        return { persisted: true };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage({
      batchId: "line_row_wait",
      phase: "row",
      rowId: "line_row_wait:0",
      sequence: 0,
    }, { messageId: "row-wait", deliveryCount: 8 });
  } catch (error) {
    thrown = error;
  }

  assert.equal(thrown?.code, "line_queue_row_retry_not_due");
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 8 }), { afterSeconds: 37 });
  assert.equal(poisonCalls, 0);
});

test("Poison delivery is acknowledged only after terminal state persists", async () => {
  const harness = consumerHarness();
  const original = Object.assign(new Error("private upstream text"), { code: "UPSTREAM_500" });
  let poisonContext;
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 3,
    loadContinuation: () => ({
      processLineMessage: async () => { throw original; },
      markLineMessagePoison: async (_message, context) => {
        poisonContext = context;
        return { persisted: true };
      },
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_poison", phase: "run", sequence: 9 },
      { messageId: "msg_poison", deliveryCount: 3, region: "iad1" },
    );
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown.code, "line_queue_poison_persisted");
  assert.equal(poisonContext.failureCode, "upstream_500");
  assert.equal(poisonContext.metadata.messageId, "msg_poison");
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 3 }), { acknowledge: true });
});

test("Unpersisted poison delivery keeps retrying", async () => {
  const harness = consumerHarness();
  const original = new Error("do not expose prospect@example.test");
  createLineQueueConsumer({
    client: harness.client,
    maxDeliveries: 2,
    loadContinuation: () => ({
      processLineMessage: async () => { throw original; },
      markLineMessagePoison: async () => ({ persisted: false }),
    }),
  });

  let thrown;
  try {
    await harness.processMessage(
      { batchId: "line_retry", phase: "run", sequence: 1 },
      { deliveryCount: 2 },
    );
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown, original);
  assert.deepEqual(lineQueueRetry(thrown, { deliveryCount: 2 }), { afterSeconds: 20 });
});

test("Rescue cron calls the same continuation service and returns counts only", async (t) => {
  const before = process.env.GHOST_AGENCY_LINE_RESCUE_BATCH;
  process.env.GHOST_AGENCY_LINE_RESCUE_BATCH = "4";
  t.after(() => {
    if (before === undefined) delete process.env.GHOST_AGENCY_LINE_RESCUE_BATCH;
    else process.env.GHOST_AGENCY_LINE_RESCUE_BATCH = before;
  });

  let loaded = 0;
  let rescueOptions;
  let response;
  const handler = createRunLineBatchesHandler({
    methodGuard: () => true,
    requireCron: () => true,
    loadContinuation: () => {
      loaded += 1;
      return {
        async rescueLineBatches(options) {
          rescueOptions = options;
          return {
            ok: true,
            selected: 3,
            continued: 2,
            completed: 1,
            rows: [{ email: "never-return@example.test" }],
          };
        },
      };
    },
    sendJson: (_res, status, body) => { response = { status, body }; },
  });

  assert.equal(loaded, 0);
  await handler({ method: "GET" }, {});
  assert.equal(loaded, 1);
  assert.deepEqual(rescueOptions, {
    source: "cron",
    rescueOnly: true,
    limit: 4,
  });
  assert.deepEqual(response, {
    status: 200,
    body: {
      ok: true,
      job: "run-line-batches",
      rescueOnly: true,
      selected: 3,
      continued: 2,
      completed: 1,
    },
  });
  assert.doesNotMatch(JSON.stringify(response), /example|email/i);
});

test("Unauthorized rescue does not load continuation code", async () => {
  let loaded = false;
  const handler = createRunLineBatchesHandler({
    methodGuard: () => true,
    requireCron: () => false,
    loadContinuation: () => {
      loaded = true;
      return {};
    },
  });
  await handler({ method: "GET" }, {});
  assert.equal(loaded, false);
});

test("Rescue failures never echo upstream exception text", async () => {
  let response;
  const handler = createRunLineBatchesHandler({
    methodGuard: () => true,
    requireCron: () => true,
    loadContinuation: () => ({
      rescueLineBatches: async () => {
        throw new Error("prospect@example.test failed");
      },
    }),
    sendJson: (_res, status, body) => { response = { status, body }; },
  });
  await handler({ method: "POST" }, {});
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    ok: false,
    job: "run-line-batches",
    rescueOnly: true,
    error: "line_rescue_failed",
  });
  assert.doesNotMatch(JSON.stringify(response), /example|prospect/i);
});

test("Vercel config registers one private consumer and one rescue cron", () => {
  const backendRoot = path.join(__dirname, "..");
  const config = JSON.parse(fs.readFileSync(path.join(backendRoot, "vercel.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(backendRoot, "package.json"), "utf8"));
  const consumer = config.functions["api/queues/line-batch.js"];

  assert.equal(packageJson.dependencies["@vercel/queue"], "0.4.0");
  assert.equal(consumer.maxDuration, 300);
  assert.deepEqual(consumer.experimentalTriggers, [{
    type: "queue/v2beta",
    topic: LINE_QUEUE_TOPIC,
    maxConcurrency: 10,
    retryAfterSeconds: 60,
    initialDelaySeconds: 0,
  }]);
  assert.deepEqual(
    config.crons.filter((cron) => cron.path === "/api/cron/run-line-batches"),
    [{ path: "/api/cron/run-line-batches", schedule: "*/2 * * * *" }],
  );
});

test("Safe rescue summary strips row detail and negative counts", () => {
  assert.deepEqual(
    safeRescueSummary({ ok: true, selected: 2, failed: -1, email: "drop@example.test" }),
    { ok: true, job: "run-line-batches", rescueOnly: true, selected: 2 },
  );
});
