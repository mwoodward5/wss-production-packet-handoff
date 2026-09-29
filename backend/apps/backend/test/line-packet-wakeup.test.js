"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PACKET_QUEUE_WAKE_TIMEOUT_MS,
  packetQueueWakeEnabled,
  wakeNewestBuildingPracticeBatch,
} = require("../lib/line-packet-wakeup");

test("packet queue wake is hard-default on with an exact 0 kill switch", async () => {
  assert.equal(packetQueueWakeEnabled({}), true);
  assert.equal(packetQueueWakeEnabled({ GHOST_AGENCY_PACKET_QUEUE_WAKE: "1" }), true);
  assert.equal(packetQueueWakeEnabled({ GHOST_AGENCY_PACKET_QUEUE_WAKE: "0" }), false);
  assert.equal(PACKET_QUEUE_WAKE_TIMEOUT_MS, 750);

  let listCalls = 0;
  let queueCalls = 0;
  const result = await wakeNewestBuildingPracticeBatch({
    environment: { GHOST_AGENCY_PACKET_QUEUE_WAKE: "0" },
    persistence: { listBatches: async () => { listCalls += 1; } },
    enqueueLineMessage: async () => { queueCalls += 1; },
  });
  assert.deepEqual(result, {
    accepted: false,
    recovery: "cron",
    reason: "packet_queue_wake_disabled",
  });
  assert.equal(listCalls, 0);
  assert.equal(queueCalls, 0);
});

test("wake selects the newest building Practice batch and sends only its opaque current-version handle", async () => {
  let listOptions;
  const messages = [];
  const batches = [
    {
      batchId: "live_newest_abc123",
      lane: "live",
      status: "building",
      version: 99,
      startedAt: "2026-08-21T12:10:00.000Z",
    },
    {
      batchId: "practice_running_abc123",
      lane: "sandbox",
      status: "running",
      version: 8,
      startedAt: "2026-08-21T12:01:00.000Z",
    },
    {
      batchId: "practice_old_abc123",
      lane: "sandbox",
      status: "building",
      version: 4,
      startedAt: "2026-08-21T12:00:00.000Z",
    },
    {
      batchId: "practice_new_abc123",
      lane: "sandbox",
      status: "building",
      version: 7,
      startedAt: "2026-08-21T12:05:00.000Z",
      email: "must-not-enter-queue@example.test",
      phone: "+15555550123",
    },
    {
      batchId: "practice_settled_abc123",
      lane: "sandbox",
      status: "done",
      version: 50,
      startedAt: "2026-08-21T12:20:00.000Z",
    },
  ];
  const options = {
    environment: {},
    timeoutMs: 100,
    persistence: {
      listBatches: async (input) => {
        listOptions = input;
        return { ok: true, batches };
      },
    },
    enqueueLineMessage: async (message) => {
      messages.push(message);
      return { accepted: true };
    },
  };

  const first = await wakeNewestBuildingPracticeBatch(options);
  const second = await wakeNewestBuildingPracticeBatch(options);

  assert.deepEqual(listOptions, {
    statuses: ["building", "running"],
    limit: 25,
    includeRows: false,
    order: "updated_at.desc",
  });
  assert.deepEqual(messages, [
    { batchId: "practice_new_abc123", phase: "run", sequence: 7 },
    { batchId: "practice_new_abc123", phase: "run", sequence: 7 },
  ], "the unchanged version produces the same Vercel Queue idempotency coordinates");
  assert.deepEqual(first, {
    accepted: true,
    batchId: "practice_new_abc123",
    phase: "run",
    sequence: 7,
  });
  assert.deepEqual(second, first);
  assert.doesNotMatch(JSON.stringify(messages), /must-not-enter-queue|5555550123|email|phone/i);
});

test("queue timeout returns inside one second, absorbs a late rejection, and leaves cron recovery", async () => {
  let rejectQueue;
  const lateQueue = new Promise((resolve, reject) => { rejectQueue = reject; });
  const startedAt = Date.now();
  const result = await wakeNewestBuildingPracticeBatch({
    environment: {},
    timeoutMs: 25,
    persistence: {
      listBatches: async () => ({
        ok: true,
        batches: [{
          batchId: "practice_timeout_abc123",
          lane: "sandbox",
          status: "building",
          version: 2,
          startedAt: "2026-08-21T12:00:00.000Z",
        }],
      }),
    },
    enqueueLineMessage: async () => lateQueue,
  });
  const elapsed = Date.now() - startedAt;

  assert.deepEqual(result, {
    accepted: false,
    recovery: "cron",
    reason: "line_queue_wake_timeout",
  });
  assert.ok(elapsed < 1_000, `queue wake took ${elapsed}ms`);
  rejectQueue(new Error("late queue rejection"));
  await new Promise((resolve) => setImmediate(resolve));
});

test("a post-pick packet gets a queue wake even while the worker is on its defer-retry path", async () => {
  const messages = [];
  const startedAt = Date.now();
  // This is the narrow race: the running worker already took an empty pick
  // snapshot, so its deferRetry result will not publishNext. The packet event
  // must publish the current running version instead of waiting for the cron.
  const result = await wakeNewestBuildingPracticeBatch({
    environment: {},
    persistence: {
      listBatches: async () => ({
        ok: true,
        batches: [
          {
            batchId: "practice_building_old_abc123",
            lane: "sandbox",
            status: "building",
            version: 2,
            startedAt: "2026-08-21T12:00:00.000Z",
          },
          {
            batchId: "practice_running_new_abc123",
            lane: "sandbox",
            status: "running",
            version: 9,
            startedAt: "2026-08-21T12:05:00.000Z",
          },
        ],
      }),
    },
    enqueueLineMessage: async (message) => {
      messages.push(message);
      return { accepted: true };
    },
  });

  assert.deepEqual(result, {
    accepted: true,
    batchId: "practice_running_new_abc123",
    phase: "run",
    sequence: 9,
  });
  assert.deepEqual(messages, [{
    batchId: "practice_running_new_abc123",
    phase: "run",
    sequence: 9,
  }], "the packet must wake the current-version worker, never the older building batch");
  assert.ok(Date.now() - startedAt < 1_000, "a post-snapshot packet must reach the queue inside one second");
});

test("list and queue failures never throw or create work", async () => {
  const listFailure = await wakeNewestBuildingPracticeBatch({
    environment: {},
    persistence: { listBatches: async () => { throw new Error("database unavailable"); } },
    enqueueLineMessage: async () => { throw new Error("must not enqueue"); },
  });
  assert.deepEqual(listFailure, {
    accepted: false,
    recovery: "cron",
    reason: "line_batch_list_failed",
  });

  let queueCalls = 0;
  const noBatch = await wakeNewestBuildingPracticeBatch({
    environment: {},
    persistence: { listBatches: async () => ({ ok: true, batches: [] }) },
    enqueueLineMessage: async () => { queueCalls += 1; },
  });
  assert.equal(noBatch.reason, "no_active_practice_batch");
  assert.equal(noBatch.recovery, "cron");
  assert.equal(queueCalls, 0);
});
