"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const human = require("../lib/line-continuation-human");
const production = require("../lib/line-continuation-production");
const resume = require("../lib/line-mirror-resume");
const page = require("../lib/operator-workspace-page-final");

function batch({ id, startedAt, status = "building", lane = "sandbox", rows = [], version = 1 }) {
  return { batchId: id, startedAt, createdAt: startedAt, updatedAt: startedAt, status, lane, rows, version };
}

test("newest idle Practice run owns the factory and older idle runs are halted", async () => {
  const writes = [];
  const newer = batch({ id: "line_new", startedAt: "2026-08-18T15:00:00.000Z" });
  const older = batch({ id: "line_old", startedAt: "2026-08-18T12:00:00.000Z", status: "running" });
  const persistence = {
    async listBatches() { return { ok: true, batches: [older, newer] }; },
    async storeBatch(input) { writes.push(input); return { ok: true }; },
    async loadBatch() { return { ok: false }; },
  };
  const service = human.createHumanContinuation({
    persistence,
    production: { async processLineMessage() { return { ok: true }; }, async rescueLineBatches() { return { ok: true }; } },
    environment: {},
  });
  const result = await service.retireSupersededPracticeBatches({ now: Date.parse("2026-08-18T16:00:00.000Z") });
  assert.equal(result.kept, "line_new");
  assert.equal(result.retired, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].batchId, "line_old");
  assert.equal(writes[0].expectedStatus, "running");
  assert.equal(writes[0].patch.status, "halted");
  assert.match(writes[0].patch.haltReason, /superseded_by_newer_practice_run:line_new/);
});

test("an older Practice run with a live row lease is allowed to finish its current phase", async () => {
  const writes = [];
  const now = Date.parse("2026-08-18T16:00:00.000Z");
  const newer = batch({ id: "line_new", startedAt: "2026-08-18T15:00:00.000Z" });
  const older = batch({
    id: "line_old",
    startedAt: "2026-08-18T12:00:00.000Z",
    rows: [{ leaseToken: "lease", leaseExpiresAt: "2026-08-18T16:04:00.000Z" }],
  });
  const service = human.createHumanContinuation({
    persistence: {
      async listBatches() { return { ok: true, batches: [newer, older] }; },
      async storeBatch(input) { writes.push(input); return { ok: true }; },
      async loadBatch() { return { ok: false }; },
    },
    production: { async processLineMessage() { return { ok: true }; }, async rescueLineBatches() { return { ok: true }; } },
    environment: {},
  });
  const result = await service.retireSupersededPracticeBatches({ now });
  assert.equal(result.retired, 0);
  assert.equal(result.deferred, 1);
  assert.equal(writes.length, 0);
});

test("includeRows:false selection still defers a live lease by loading the candidate's rows", async () => {
  // Mirrors production: listBatches returns batches with EMPTY rows (the
  // memory/timeout fix), and the live-lease check loads each retire candidate's
  // rows individually via loadBatch. A live lease must still defer the retire.
  const writes = [];
  const now = Date.parse("2026-08-18T16:00:00.000Z");
  const newer = batch({ id: "line_new", startedAt: "2026-08-18T15:00:00.000Z", rows: [] });
  const older = batch({ id: "line_old", startedAt: "2026-08-18T12:00:00.000Z", rows: [] });
  const olderWithLease = batch({
    id: "line_old",
    startedAt: "2026-08-18T12:00:00.000Z",
    rows: [{ leaseToken: "lease", leaseExpiresAt: "2026-08-18T16:04:00.000Z" }],
  });
  const service = human.createHumanContinuation({
    persistence: {
      async listBatches() { return { ok: true, batches: [newer, older] }; },
      async loadBatch(id) { return id === "line_old" ? { ok: true, batch: olderWithLease } : { ok: false }; },
      async storeBatch(input) { writes.push(input); return { ok: true }; },
    },
    production: { async processLineMessage() { return { ok: true }; }, async rescueLineBatches() { return { ok: true }; } },
    environment: {},
  });
  const result = await service.retireSupersededPracticeBatches({ now });
  assert.equal(result.retired, 0, "a live lease loaded via loadBatch must defer");
  assert.equal(result.deferred, 1);
  assert.equal(writes.length, 0);
});

test("includeRows:false selection retires an idle superseded run (no live lease)", async () => {
  const writes = [];
  const now = Date.parse("2026-08-18T16:00:00.000Z");
  const newer = batch({ id: "line_new", startedAt: "2026-08-18T15:00:00.000Z", rows: [] });
  const older = batch({ id: "line_old", startedAt: "2026-08-18T12:00:00.000Z", status: "running", rows: [] });
  const olderIdle = batch({ id: "line_old", startedAt: "2026-08-18T12:00:00.000Z", status: "running", rows: [{ leaseToken: null, leaseExpiresAt: null }] });
  const service = human.createHumanContinuation({
    persistence: {
      async listBatches() { return { ok: true, batches: [newer, older] }; },
      async loadBatch(id) { return id === "line_old" ? { ok: true, batch: olderIdle } : { ok: false }; },
      async storeBatch(input) { writes.push(input); return { ok: true }; },
    },
    production: { async processLineMessage() { return { ok: true }; }, async rescueLineBatches() { return { ok: true }; } },
    environment: {},
  });
  const result = await service.retireSupersededPracticeBatches({ now });
  assert.equal(result.kept, "line_new");
  assert.equal(result.retired, 1);
  assert.equal(writes[0].batchId, "line_old");
});

test("rescue cron services the current building Practice run before registry backlog", async () => {
  const current = batch({ id: "line_current", startedAt: "2026-08-18T16:00:00.000Z", version: 7 });
  let direct = 0;
  let generic = 0;
  const service = human.createHumanContinuation({
    persistence: {
      async listBatches() { return { ok: true, batches: [current] }; },
      async loadBatch(id) { return id === current.batchId ? { ok: true, batch: current } : { ok: false }; },
      async storeBatch() { return { ok: true }; },
    },
    production: {
      async processLineMessage(message) {
        direct += 1;
        assert.equal(message.batchId, "line_current");
        assert.equal(message.phase, "run");
        return { ok: true, status: "building", processed: 1 };
      },
      async rescueLineBatches() { generic += 1; return { ok: true }; },
    },
    environment: {},
  });
  const result = await service.rescueLineBatches();
  assert.equal(result.currentPriority, true);
  assert.equal(direct, 1);
  assert.equal(generic, 0);
});

test("human telemetry groups terminal causes without prospect details", () => {
  assert.deepEqual(human.terminalReasonSummary({ rows: [
    { status: "error", reason: "mirror_build_timed_out_after_250s" },
    { status: "error", reason: "mirror_build_timed_out_after_250s" },
    { status: "rejected", reason: "brand asset rejected" },
    { status: "qualified", reason: "not terminal" },
  ] }), [
    { reason: "mirror_build_timed_out_after_250s", count: 2 },
    { reason: "brand_asset_rejected", count: 1 },
  ]);
});

test("human telemetry prefers the persisted exact Mirror cause over a generic row reason", () => {
  assert.deepEqual(human.terminalReasonSummary({ rows: [{
    status: "error",
    reason: "mirror_dispatch_failed_before_build",
    businessName: "Must Not Appear",
    mirrorDispatch: {
      failure: {
        code: "mirror_input_binding_mismatch",
        detail: "Business URL https://private.example.test did not match",
        reason: "adapter refused client secret=do-not-log",
      },
    },
  }] }), [
    { reason: "mirror_input_binding_mismatch", count: 1 },
  ]);
});

test("human telemetry never groups opaque code-shaped Mirror secrets", () => {
  assert.deepEqual(human.terminalReasonSummary({ rows: [{
    status: "error",
    reason: "mirror_dispatch_failed_before_build",
    mirrorDispatch: {
      failure: {
        code: "secret123",
        detail: "safe_shaped_secret",
        reason: "token_abc123",
      },
    },
  }] }), [
    { reason: "mirror_failure_code_redacted", count: 1 },
  ]);
});

test("Mirror Engine deadline is retryable and keeps the same prospect operation", async () => {
  let seenDeadline = 0;
  await assert.rejects(
    () => resume.mirrorProspectResumable({ prospectId: "p1" }, {
      deadlineAt: 1_000_000,
      operationKey: "line:b:p1:mirror",
      baseMirror: async (_row, options) => {
        seenDeadline = options.deadlineAt;
        assert.equal(options.operationKey, "line:b:p1:mirror");
        return { ok: false, reason: "mirror_deadline (status 504) — caller_abort_or_checkpoint_reserve" };
      },
    }),
    (error) => error && error.retryable === true && error.code === "mirror_deadline_retry",
  );
  assert.equal(seenDeadline, 1_000_000 + resume.LINE_ENGINE_DEADLINE_EXTENSION_MS);
  assert.equal(resume.LINE_ENGINE_DEADLINE_EXTENSION_MS, 15_000);
});

test("genuine mirror refusal stays a genuine refusal", async () => {
  const result = await resume.mirrorProspectResumable({ prospectId: "p2" }, {
    deadlineAt: 1_000_000,
    baseMirror: async () => ({ ok: false, reason: "brand_asset_rejected" }),
  });
  assert.deepEqual(result, { ok: false, reason: "brand_asset_rejected" });
});

// Queue concurrency now supplies the fleet width. A production delivery must
// never widen either browser-heavy claim, including its cron/fallback path.
test("production keeps every browser-heavy delivery at one exact row", () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  try {
    process.env.FIRECRAWL_API_KEY = "fc-test";
    assert.equal(production.productionClaimLimit({ limit: 2, statuses: ["qualified"] }), 1);
    assert.equal(production.productionClaimLimit({ limit: 2, statuses: ["mirrored"] }), 1);
    assert.equal(production.productionClaimLimit({ limit: 2, statuses: ["picked"] }), 2);
    delete process.env.FIRECRAWL_API_KEY;
    assert.equal(production.productionClaimLimit({ limit: 2, statuses: ["mirrored"] }), 1);
  } finally {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous;
  }
});

test("production timing remains below the platform ceiling", () => {
  assert.equal(production.MIRROR_PHASE_TIMEOUT_MS, 650_000);
  assert.equal(production.EFFECTIVE_WORKER_DEADLINE_MS, 662_000);
  assert.equal(production.ROW_LEASE_MS, 672_000);
  assert.equal(production.VERCEL_FUNCTION_CEILING_MS, 800_000);
  assert.ok(production.MIRROR_PHASE_TIMEOUT_MS < production.EFFECTIVE_WORKER_DEADLINE_MS);
  assert.ok(production.EFFECTIVE_WORKER_DEADLINE_MS < production.ROW_LEASE_MS);
  assert.ok(production.ROW_LEASE_MS < production.VERCEL_FUNCTION_CEILING_MS);
});

test("Home is a one-current-run workspace and explains idle/failure states", () => {
  assert.match(page, /host\.innerHTML=productionCard\(active\[0\]\)/);
  assert.doesNotMatch(page, /active\.slice\(0,3\)\.map\(productionCard\)/);
  assert.match(page, /Older practice runs are being retired automatically/);
  assert.match(page, /Queued for worker/);
  assert.match(page, /failureReason\(r\)/);
  assert.match(page, /website build ran out of time/);
  assert.match(page, /built site did not pass live verification/);
});
