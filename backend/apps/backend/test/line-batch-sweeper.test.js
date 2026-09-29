"use strict";

// The measured production defect this suite pins: six batches (hvac in six
// cities, started 2026-08-10 ~01:10) stuck status="running" with 16 rows
// frozen "working" for ~30 hours after their lambdas died. Each held one
// finished, gate-passed, QUEUED site — and approveBatch demands a settled
// batch, so six sendable sites were unapprovable and the owner saw no approve
// button anywhere. The old sweeper converted recoverable phase checkpoints to
// permanent errors. The replacement requeues them unchanged so a server
// worker can claim the next phase; it must NEVER touch a batch whose rows moved
// recently, and it must never start work.

const test = require("node:test");
const assert = require("node:assert/strict");

const lineState = require("../lib/line-state");
const runner = require("../lib/line-runner");
const sweeper = require("../lib/line-batch-sweeper");

// The production shape: started 2026-08-10T01:10Z, examined ~30 hours later.
const STARTED = "2026-08-10T01:10:00.000Z";
const NOW = Date.parse(STARTED) + 30 * 60 * 60 * 1000;

function workingRow(id, nowIso) {
  let row = lineState.newRow({ prospectId: id, businessName: "Biz " + id, city: "Columbus", state: "OH", now: nowIso });
  row = lineState.advanceRow(row, "qualified", { now: nowIso }).row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: `https://${id}.wss-ai.com/`, now: nowIso }).row;
  return row; // "mirrored" — exactly the frozen mid-build shape production showed
}

function queuedRow(id, nowIso) {
  let row = workingRow(id, nowIso);
  row = lineState.applyGate(row, { pass: true, failed: [], checks: [] }, { now: nowIso }).row;
  row = lineState.advanceRow(row, "queued", { previewUrl: row.previewUrl, now: nowIso }).row;
  return row;
}

function stuckProductionBatch(batchId, nowIso = STARTED) {
  const batch = lineState.newBatch({ batchId, lane: "sandbox", target: "hvac in Columbus OH", now: nowIso });
  batch.requested = 10;
  batch.rows = [
    queuedRow(`${batchId}-finished`, nowIso),
    workingRow(`${batchId}-frozen-1`, nowIso),
    workingRow(`${batchId}-frozen-2`, nowIso),
  ];
  return batch; // status "running", never settled
}

test("a running batch frozen for 30 hours fails its inspection rows and frees the approve slot", async () => {
  const batch = stuckProductionBatch("line_stuck_columbus");
  assert.equal(
    lineState.approveBatch(batch, { typedBatchId: batch.batchId }).error,
    "batch_still_running",
    "precondition: this is exactly why the owner saw no approve button",
  );

  const persisted = [];
  const events = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: (b) => { persisted.push(b); return b; },
    recordEvent: async (type, payload) => { events.push({ type, payload }); },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.examined, 1);
  // Inspection timeout settles the batch directly — it does not appear in the
  // batch-level sweep list (which only covers 30-minute batch staleness).
  assert.deepEqual(result.swept, []);

  const settled = persisted[0];
  // Rows that timed out in the inspection phase are now terminal errors.
  assert.equal(settled.status, "awaiting_approval", "queued site is approvable now");
  assert.ok(settled.settledAt, "settled timestamp is recorded");
  assert.equal(settled.sweep.reason, "inspection_timed_out");
  assert.equal(settled.sweep.was, "running");
  assert.equal(settled.sweep.closedRows, 2);
  assert.equal(settled.sweep.requeuedRows, 0);

  // The inspection-timed-out rows are now terminal (error), not stuck.
  const frozen = settled.rows.filter((r) => r.prospectId.includes("frozen"));
  assert.equal(frozen.length, 2);
  for (const row of frozen) {
    assert.equal(row.status, "error");
    assert.ok(row.reason.startsWith("inspection_timed_out"), `reason: ${row.reason}`);
  }

  // The finished (queued) site is untouched.
  const finished = settled.rows.find((r) => r.prospectId.includes("finished"));
  assert.equal(finished.status, "queued");

  // The approve button is now available — the batch is awaiting_approval.
  const approved = lineState.approveBatch(settled, { typedBatchId: settled.batchId, actor: "owner" });
  assert.equal(approved.ok, true, "owner can now approve the cleared batch");

  // The audit trail names what happened.
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "line.inspection_rows_timed_out");
  assert.equal(events[0].payload.failedRows, 2);
});

test("CONTROL: a batch where one row moved recently skips the stale sweep but closes any individually-jammed rows", async () => {
  const batch = stuckProductionBatch("line_live_run");
  // One row moved five minutes ago — within JAMMED_ROW_MS (8 min), so not jammed.
  // The other working row (rows[1]) has STARTED timestamp = 30 hours ago and no
  // lease — it IS jammed and must be closed by the per-row sweep.
  const fresh = new Date(NOW - 5 * 60 * 1000).toISOString();
  batch.rows[2] = { ...batch.rows[2], updatedAt: fresh };

  const persisted = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: (b) => { persisted.push(b); },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.examined, 1);
  // The batch-level stale sweep never fires (one row moved < STALE_BATCH_MS ago).
  assert.deepEqual(result.swept, []);
  // The jammed row IS closed; the recently-moved row is left alone.
  assert.equal(persisted.length, 1, "jammed row triggers one putBatch write");
  const written = persisted[0];
  assert.equal(written.status, "building", "batch downgraded to building so continuation can pick up");
  assert.equal(written.rows[1].status, "error", "jammed row with expired lease is closed");
  assert.equal(written.rows[2].status, "mirrored", "recently-moved row is left unchanged");
  assert.equal(batch.rows[1].status, "mirrored", "original batch object is never mutated");
});

test("a stale batch holding only mirrored rows fails them via inspection timeout instead of becoming building", async () => {
  const batch = lineState.newBatch({ batchId: "line_all_dead", lane: "sandbox", target: "hvac in Reno NV", now: STARTED });
  batch.rows = [workingRow("line_all_dead-a", STARTED), workingRow("line_all_dead-b", STARTED)];

  const persisted = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: (b) => persisted.push(b),
    now: NOW,
  });

  // Inspection timeout fires (all rows mirrored, batch quiet for 30h).
  // No batch-level sweep entry — the inspection timeout settled the batch.
  assert.deepEqual(result.swept, []);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].status, "done", "no queued rows → done");
  assert.equal(persisted[0].sweep.reason, "inspection_timed_out");
  for (const row of persisted[0].rows) {
    assert.equal(row.status, "error");
  }
});

test("legacy terminal-only build batches keep the old awaiting_approval and done outcomes", async () => {
  const approvable = lineState.newBatch({ batchId: "line_terminal_queue", lane: "sandbox", now: STARTED });
  approvable.rows = [queuedRow("line_terminal_queue-ready", STARTED)];
  const empty = lineState.newBatch({ batchId: "line_terminal_empty", lane: "sandbox", now: STARTED });
  let rejected = workingRow("line_terminal_empty-rejected", STARTED);
  rejected = lineState.advanceRow(rejected, "rejected", { reason: "not qualified", now: STARTED }).row;
  empty.rows = [rejected];
  const saved = [];

  const result = await sweeper.sweepLineBatches({
    listBatches: async () => [approvable, empty],
    putBatch: async (batch) => { saved.push(batch); },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.swept.map((entry) => entry.settledTo), ["awaiting_approval", "done"]);
  assert.deepEqual(saved.map((batch) => batch.status), ["awaiting_approval", "done"]);
  assert.equal(saved[0].rows[0], approvable.rows[0]);
  assert.equal(saved[1].rows[0], empty.rows[0]);
});

test("a stale sending batch returns to approved with its queued rows intact, and the resumable send picks it up", async () => {
  runner.resetBatches();
  const batch = lineState.newBatch({ batchId: "line_dead_send", lane: "sandbox", target: "hvac in Spokane WA", now: STARTED });
  let sentRow = queuedRow("line_dead_send-sent", STARTED);
  sentRow = lineState.advanceRow(sentRow, "sent", { now: STARTED }).row;
  batch.rows = [sentRow, queuedRow("line_dead_send-remaining", STARTED)];
  batch.status = "sending"; // the lambda died mid-pass, before the settle write
  batch.approval = { actor: "owner", at: STARTED, approvedRows: 2, typedBatchId: batch.batchId };

  const result = await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: runner.putBatch,
    now: NOW,
  });

  assert.deepEqual(result.swept.map((s) => ({ settledTo: s.settledTo, closedRows: s.closedRows, queued: s.queued })), [
    { settledTo: "approved", closedRows: 0, queued: 1 },
  ]);
  const swept = runner.getBatch("line_dead_send");
  assert.equal(swept.status, "approved");
  assert.equal(swept.rows[1].status, "queued", "an approved-but-unsent row is remaining work, not a failure");

  // The stuck "sending" status refused every resume; "approved" is the resume.
  const recipients = [];
  const pass = await runner.sendApprovedBatch("line_dead_send", {
    send: async (row) => { recipients.push(row.prospectId); return { ok: true }; },
  });
  assert.equal(pass.ok, true);
  assert.deepEqual(recipients, ["line_dead_send-remaining"]);
  assert.equal(pass.remaining, 0);
  runner.resetBatches();
});

test("settled and halted batches are none of the sweeper's business", async () => {
  const done = { ...stuckProductionBatch("line_done"), status: "done" };
  const waiting = { ...stuckProductionBatch("line_waiting"), status: "awaiting_approval" };
  const halted = { ...stuckProductionBatch("line_halted"), status: "halted" };
  let persistCalls = 0;
  const result = await sweeper.sweepLineBatches({
    listBatches: () => [done, waiting, halted],
    putBatch: () => { persistCalls += 1; },
    now: NOW,
  });
  assert.deepEqual(result.swept, []);
  assert.equal(persistCalls, 0);
});

test("halted batch is preserved despite stale leases, timeout rows, and a delayed orphan refire", async () => {
  const halted = lineState.newBatch({ batchId: "line_halted_absolute", lane: "sandbox", target: "hvac", now: STARTED });
  halted.status = "halted";
  halted.version = 17;
  halted.updatedAt = STARTED;
  const staleQualified = lineState.advanceRow(
    lineState.newRow({ prospectId: "halted-qualified", businessName: "Halted Qualified", city: "Austin", state: "TX", now: STARTED }),
    "qualified",
    { now: STARTED },
  ).row;
  const staleMirrored = workingRow("halted-mirrored", STARTED);
  halted.rows = [
    { ...staleQualified, leaseToken: "halted-qualified-lease", leaseExpiresAt: STARTED },
    { ...staleMirrored, leaseToken: "halted-mirrored-lease", leaseExpiresAt: STARTED },
  ];
  halted.mineFunnel = [{
    stage: sweeper.START_WATCH_STAGE,
    accepted_run_id: "line:v1:line_halted_absolute:run:17",
    accepted_sequence: 17,
    claimed_at: STARTED,
    orphan_ticks: 1,
    still_needed: 1,
  }];
  const before = structuredClone(halted);
  let writes = 0;
  let releases = 0;
  let refires = 0;
  let events = 0;

  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [halted] }),
    putBatch: async () => { writes += 1; },
    storeBatch: async () => { writes += 1; return { ok: true }; },
    releaseRow: async () => { releases += 1; return { ok: true }; },
    refireBatch: async () => { refires += 1; return { accepted: true }; },
    recordEvent: async () => { events += 1; },
    orphanSignal: true,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.swept, []);
  assert.deepEqual(result.refired, []);
  assert.equal(writes, 0, "halted batch must not be stored or reopened");
  assert.equal(releases, 0, "halted batch must not release stale row leases");
  assert.equal(refires, 0, "still_needed must not refire a halted batch");
  assert.equal(events, 0, "halted batch must not emit a sweep event");
  assert.deepEqual(halted, before, "halted snapshot must remain byte-for-byte unchanged");

  assert.equal(sweeper.failStaleInspectionRows(halted, NOW, new Date(NOW).toISOString()).failed, 0);
  assert.equal(sweeper.failStaleMirrorBuildRows(halted, NOW, new Date(NOW).toISOString()).failed, 0);
  assert.deepEqual(
    sweeper.settleStuckBatch(halted, { staleMs: NOW - Date.parse(STARTED) }, new Date(NOW).toISOString()),
    { batch: halted, closedRows: 0, requeuedRows: 0, settledTo: "halted" },
  );
});

test("a halted batch does not block recovery of an unrelated stale batch", async () => {
  const halted = { ...stuckProductionBatch("line_halted_neighbor"), status: "halted" };
  const recoverable = stuckProductionBatch("line_recoverable_neighbor");
  const persisted = [];

  const result = await sweeper.sweepLineBatches({
    listBatches: async () => [halted, recoverable],
    putBatch: async (next) => { persisted.push(next); },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.examined, 2);
  assert.equal(persisted.length, 1, "only the unrelated running batch is persisted");
  assert.equal(persisted[0].batchId, "line_recoverable_neighbor");
  assert.equal(persisted[0].status, "awaiting_approval");
  assert.equal(halted.status, "halted");
  assert.equal(halted.rows[1].status, "mirrored", "halted rows remain untouched");
});

test("classifyStuckBatch: fresh is in_flight, old is stale, undateable is stale", () => {
  const fresh = stuckProductionBatch("line_fresh", new Date(NOW - 60 * 1000).toISOString());
  assert.equal(sweeper.classifyStuckBatch(fresh, NOW).state, "in_flight");

  const old = stuckProductionBatch("line_old");
  const oldVerdict = sweeper.classifyStuckBatch(old, NOW);
  assert.equal(oldVerdict.state, "stale");
  assert.ok(oldVerdict.staleMs >= 29 * 60 * 60 * 1000);

  const undateable = { batchId: "line_blank", status: "running", startedAt: "not-a-date", rows: [{ status: "picked", updatedAt: "" }] };
  assert.equal(sweeper.classifyStuckBatch(undateable, NOW).state, "stale");

  assert.equal(sweeper.classifyStuckBatch({ batchId: "b", status: "done", rows: [] }, NOW).state, "settled");
});

test("workerClaimActive accepts only valid claims strictly inside the canonical liveness window", () => {
  assert.equal(sweeper.workerClaimActive({}, NOW), false);
  assert.equal(sweeper.workerClaimActive({ claimed_at: "not-a-date" }, NOW), false);
  assert.equal(sweeper.workerClaimActive({ claimed_at: new Date(NOW - 30_000).toISOString() }, NOW), true);
  assert.equal(
    sweeper.workerClaimActive({ claimed_at: new Date(NOW - sweeper.WORKER_CLAIM_LIVENESS_MS).toISOString() }, NOW),
    false,
    "the exact stale boundary is reclaimable",
  );
  assert.equal(
    sweeper.workerClaimActive({ claimed_at: new Date(NOW + 60 * 60 * 1000).toISOString() }, NOW),
    false,
    "a far-future timestamp cannot suppress orphan recovery",
  );
});

test("the opportunistic trigger pays for at most one sweep a minute per instance", async () => {
  sweeper.resetSweepThrottle();
  let listCalls = 0;
  const deps = {
    listBatches: () => { listCalls += 1; return []; },
    putBatch: () => {},
  };
  const first = await sweeper.maybeSweepLineBatches({ ...deps, now: NOW });
  assert.equal(first.ok, true);
  assert.equal(listCalls, 1);

  const second = await sweeper.maybeSweepLineBatches({ ...deps, now: NOW + 30 * 1000 });
  assert.equal(second.skipped, "throttled");
  assert.equal(listCalls, 1, "a throttled call must not touch the registry");

  const third = await sweeper.maybeSweepLineBatches({ ...deps, now: NOW + 61 * 1000 });
  assert.equal(third.skipped, undefined);
  assert.equal(listCalls, 2);
  sweeper.resetSweepThrottle();
});

test("a sweep failure is contained: one unlistable registry answers ok:false and never throws", async () => {
  const result = await sweeper.sweepLineBatches({
    listBatches: () => { throw new Error("store unreachable"); },
    putBatch: () => {},
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /store unreachable/);
  assert.deepEqual(result.swept, []);
});

test("canonical stale rows release expired leases, CAS the batch to building, and emit only allowlisted audit fields", async () => {
  const batch = stuckProductionBatch("line_canonical_requeue");
  batch.version = 7;
  batch.updatedAt = STARTED;
  batch.target = "Call owner@example.com at 415-555-0100";
  batch.rows = batch.rows.map((row, index) => ({
    ...row,
    rowId: `${batch.batchId}:${index}`,
    version: 10 + index,
    email: "owner@example.com",
    ...(row.status === "mirrored" ? {
      leaseToken: `dead-token-${index}`,
      leaseOwner: "dead-worker",
      leaseExpiresAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    } : {}),
  }));

  const order = [];
  const released = [];
  const stores = [];
  const events = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    releaseRow: async (input) => {
      order.push(`release:${input.rowId}`);
      released.push(input);
      return { ok: true };
    },
    storeBatch: async (input) => {
      order.push("store");
      stores.push(input);
      return { ok: true };
    },
    recordEvent: async (type, payload) => {
      order.push("audit");
      events.push({ type, payload });
    },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(result.swept.length, 1);
  assert.equal(result.swept[0].requeuedRows, 2);
  assert.equal(result.swept[0].releasedLeases, 2);
  assert.deepEqual(released, [
    { rowId: "line_canonical_requeue:1", leaseToken: "dead-token-1", expectedVersion: 11, expectedStatus: "mirrored" },
    { rowId: "line_canonical_requeue:2", leaseToken: "dead-token-2", expectedVersion: 12, expectedStatus: "mirrored" },
  ]);
  assert.deepEqual(stores, [{
    batchId: "line_canonical_requeue",
    expectedVersion: 7,
    expectedStatus: "running",
    patch: { status: "building", settledAt: null },
  }]);
  assert.deepEqual(order, [
    "release:line_canonical_requeue:1",
    "release:line_canonical_requeue:2",
    "store",
    "audit",
  ], "leases and batch state are durably written before the audit");
  assert.equal(events[0].type, "line.batch_swept");
  assert.deepEqual(Object.keys(events[0].payload).sort(), [
    "batchId", "closedRows", "queued", "releasedLeases", "requeuedRows", "settledTo", "staleMs", "was",
  ]);
  assert.doesNotMatch(JSON.stringify(events), /owner@example\.com|415-555-0100|dead-token|dead-worker/);
  assert.equal(batch.rows[1].status, "mirrored", "the durable checkpoint is never changed to error");
});

test("an unexpired canonical lease is treated as live even when old timestamps look stale", async () => {
  const batch = stuckProductionBatch("line_canonical_live_lease");
  batch.version = 2;
  batch.updatedAt = STARTED;
  batch.rows = batch.rows.map((row, index) => ({ ...row, rowId: `${batch.batchId}:${index}`, version: index }));
  batch.rows[1] = {
    ...batch.rows[1],
    leaseToken: "active-token",
    leaseExpiresAt: new Date(NOW + 60 * 1000).toISOString(),
  };
  let writes = 0;
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    releaseRow: async () => { writes += 1; return { ok: true }; },
    storeBatch: async () => { writes += 1; return { ok: true }; },
    now: NOW,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.swept, []);
  assert.equal(writes, 0);
});

test("a canonical lease release failure is fail-closed and the batch CAS is not attempted", async () => {
  const batch = stuckProductionBatch("line_canonical_release_fail");
  batch.version = 3;
  batch.updatedAt = STARTED;
  batch.rows = batch.rows.map((row, index) => ({
    ...row,
    rowId: `${batch.batchId}:${index}`,
    version: index,
    ...(row.status === "mirrored" ? { leaseToken: `expired-${index}`, leaseExpiresAt: STARTED } : {}),
  }));
  let storeCalls = 0;
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    releaseRow: async () => ({ ok: false, error: "version_conflict" }),
    storeBatch: async () => { storeCalls += 1; return { ok: true }; },
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.swept, []);
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].error, /canonical_release_failed:version_conflict/);
  assert.equal(storeCalls, 0);
});

test("a rejected legacy snapshot write is awaited and reported as a failed sweep", async () => {
  const batch = stuckProductionBatch("line_legacy_write_fail");
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => [batch],
    putBatch: async () => { throw new Error("snapshot write failed"); },
    now: NOW,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.swept, []);
  assert.match(result.failures[0].error, /snapshot write failed/);
});

test("the sweeper can release ownership but has no way to build or send", () => {
  const source = require("node:fs").readFileSync(require.resolve("../lib/line-batch-sweeper"), "utf8");
  const requires = [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(requires, ["./line-state"], "the sweep must not even be able to reach the build (line-runner) or send (email) paths");
});

test("accepted-but-unclaimed batches self-refire on the second sweeper tick", async () => {
  const batch = lineState.newBatch({ batchId: "line_watch_unclaimed", lane: "sandbox", target: "hvac", now: STARTED });
  batch.status = "building";
  batch.updatedAt = new Date(NOW - 60 * 1000).toISOString();
  batch.mineFunnel = [{
    stage: sweeper.START_WATCH_STAGE,
    accepted_run_id: "line:v1:line_watch_unclaimed:run:4",
    accepted_sequence: 4,
    unclaimed_ticks: 1,
  }];
  const persisted = [];
  const publications = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    putBatch: async (next) => { persisted.push(next); },
    refireBatch: async (message) => { publications.push(message); return { accepted: true }; },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.refired, [{ batchId: "line_watch_unclaimed", reason: "accepted_unclaimed_batch" }]);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].batchId, "line_watch_unclaimed");
  assert.equal(publications[0].phase, "run");
  const finalWatch = persisted.at(-1).mineFunnel.find((row) => row.stage === sweeper.START_WATCH_STAGE);
  assert.equal(finalWatch.unclaimed_ticks, 0);
  assert.equal(finalWatch.refire_count, 1);
  assert.equal(finalWatch.last_refire_reason, "accepted_unclaimed_batch");
});

test("a fresh claimed empty running batch ignores an instance-local orphan signal", async () => {
  const claimedAt = new Date(NOW - 30_000).toISOString();
  const batch = lineState.newBatch({ batchId: "line_watch_fresh_claim", lane: "sandbox", target: "hvac", now: STARTED });
  batch.status = "running";
  batch.pickState = "picking";
  batch.version = 19;
  batch.updatedAt = STARTED;
  batch.rows = [];
  batch.mineFunnel = [{
    stage: sweeper.START_WATCH_STAGE,
    accepted_run_id: "line:v1:line_watch_fresh_claim:run:19",
    accepted_sequence: 19,
    claimed_at: claimedAt,
    orphan_ticks: 1,
  }];
  let writes = 0;
  let publishes = 0;
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    storeBatch: async () => { writes += 1; return { ok: true }; },
    refireBatch: async () => { publishes += 1; return { accepted: true }; },
    orphanSignal: true,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.swept, []);
  assert.deepEqual(result.refired, []);
  assert.equal(writes, 0, "a fresh durable claim must keep its batch version for the live worker's release CAS");
  assert.equal(publishes, 0, "an instance-local orphan signal cannot duplicate a live durable worker");
  assert.equal(batch.version, 19);
  assert.equal(batch.status, "running");
  assert.equal(batch.pickState, "picking");
  assert.equal(batch.mineFunnel[0].orphan_ticks, 1, "even watch housekeeping must not mutate a fresh claim");
});

test("a stale deploy-swap orphan still refires on the second orphan tick when spend is empty", async () => {
  const batch = lineState.newBatch({ batchId: "line_watch_orphan", lane: "sandbox", target: "hvac", now: STARTED });
  batch.status = "running";
  batch.version = 8;
  batch.updatedAt = new Date(NOW - 60 * 1000).toISOString();
  batch.rows = [workingRow("line_watch_orphan-row", STARTED)];
  batch.mineFunnel = [{
    stage: sweeper.START_WATCH_STAGE,
    accepted_run_id: "line:v1:line_watch_orphan:run:8",
    accepted_sequence: 8,
    claimed_at: STARTED,
    orphan_ticks: 1,
  }];
  assert.ok(NOW - Date.parse(batch.mineFunnel[0].claimed_at) >= sweeper.WORKER_CLAIM_LIVENESS_MS);
  const publications = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    putBatch: async () => {},
    refireBatch: async (message) => { publications.push(message); return { accepted: true }; },
    orphanSignal: true,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.refired, [{ batchId: "line_watch_orphan", reason: "orphaned_running_batch" }]);
  assert.equal(publications.length, 1);
  assert.equal(publications[0].batchId, "line_watch_orphan");
});

test("healthy running batches with an active lease never duplicate a refire", async () => {
  const batch = lineState.newBatch({ batchId: "line_watch_healthy", lane: "sandbox", target: "hvac", now: STARTED });
  batch.status = "running";
  batch.updatedAt = new Date(NOW - 60 * 1000).toISOString();
  batch.rows = [{
    ...workingRow("line_watch_healthy-row", STARTED),
    leaseToken: "active-token",
    leaseExpiresAt: new Date(NOW + 60 * 1000).toISOString(),
  }];
  batch.mineFunnel = [{
    stage: sweeper.START_WATCH_STAGE,
    accepted_run_id: "line:v1:line_watch_healthy:run:2",
    accepted_sequence: 2,
    claimed_at: STARTED,
    orphan_ticks: 1,
  }];
  let publishes = 0;
  const writes = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => ({ ok: true, batches: [batch] }),
    putBatch: async (next) => { writes.push(next); },
    refireBatch: async () => { publishes += 1; return { accepted: true }; },
    orphanSignal: true,
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.refired, []);
  assert.equal(publishes, 0);
  const finalWatch = writes.at(-1).mineFunnel.find((row) => row.stage === sweeper.START_WATCH_STAGE);
  assert.equal(finalWatch.orphan_ticks, 0);
});

// ---------------------------------------------------------------------------
// JAMMED ROW REPLACEMENT (issue #374)
// A row stuck in a working state for more than JAMMED_ROW_MS with no active
// lease is a dead build process. Even when other rows in the same batch
// progressed recently (so the batch-level stale clock never fires), the
// jammed row must be closed and a refire triggered so the quota replacement
// loop claims the next prospect within one cron tick.
// ---------------------------------------------------------------------------

test("a jammed row (expired lease, stuck > JAMMED_ROW_MS) is closed and a refire is triggered", async () => {
  const JAMMED_AT = new Date(NOW - sweeper.JAMMED_ROW_MS - 60_000).toISOString(); // 11 min ago — past the 10-min threshold
  const RECENT_AT = new Date(NOW - 2 * 60 * 1000).toISOString();                 // 2 min ago — still active

  const batch = lineState.newBatch({ batchId: "line_jammed_test", lane: "sandbox", target: "leadminer", now: STARTED });
  batch.status = "running";
  batch.requested = 10;
  batch.rows = [
    // Already finished — not jammed, not touched.
    { ...workingRow("jammed-finished", STARTED), status: "queued", updatedAt: STARTED },
    // Jammed: working status, no lease, last moved more than JAMMED_ROW_MS ago.
    { ...workingRow("jammed-frozen", STARTED), updatedAt: JAMMED_AT },
    // Active: working status, no lease but moved recently — not yet jammed.
    { ...workingRow("jammed-active", STARTED), updatedAt: RECENT_AT },
  ];
  batch.updatedAt = RECENT_AT; // batch itself looks recently-moved (not stale overall)

  const persisted = [];
  const publications = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => [batch],
    putBatch: async (b) => { persisted.push(b); },
    refireBatch: async (msg) => { publications.push(msg); return { accepted: true }; },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.swept, [], "batch-level stale sweep must not fire — batch is not stale");
  assert.equal(persisted.length, 1, "exactly one write: the jammed-row batch update");

  const written = persisted[0];
  assert.equal(written.status, "building", "batch set to building so continuation can pick up");
  assert.equal(written.sweep.reason, "jammed_row_replaced");

  assert.equal(written.rows[0].status, "queued", "finished rows are untouched");
  assert.equal(written.rows[1].status, "error", "jammed row is closed");
  assert.ok(written.rows[1].reason.startsWith("worker_stopped"), "closed row carries the standard WORKER_STOPPED_SAY");
  assert.equal(written.rows[2].status, "mirrored", "recently-moved row is preserved");
  assert.equal(batch.rows[1].status, "mirrored", "original batch object is not mutated");

  assert.equal(result.refired.length, 1, "refire is triggered to wake the pick loop");
  assert.equal(result.refired[0].batchId, "line_jammed_test");
  assert.equal(result.refired[0].reason, "jammed_row_replaced");
  assert.equal(publications[0].phase, "run");
});

test("a row with an active lease is never treated as jammed regardless of age", async () => {
  const batch = lineState.newBatch({ batchId: "line_active_lease_test", lane: "sandbox", target: "leadminer", now: STARTED });
  batch.status = "running";
  batch.rows = [{
    ...workingRow("lease-held", STARTED),
    updatedAt: new Date(NOW - sweeper.JAMMED_ROW_MS - 60_000).toISOString(), // old enough to jam
    leaseToken: "still-live",
    leaseExpiresAt: new Date(NOW + 60_000).toISOString(), // lease still valid
  }];
  batch.updatedAt = STARTED;

  let persistCalls = 0;
  const result = await sweeper.sweepLineBatches({
    listBatches: async () => [batch],
    putBatch: async () => { persistCalls += 1; },
    now: NOW,
  });

  assert.equal(result.ok, true);
  assert.equal(persistCalls, 0, "a row with an active lease is live — must not be written");
});

test("rowJammed returns true only for expired-lease rows stuck past JAMMED_ROW_MS", () => {
  const OLD = NOW - sweeper.JAMMED_ROW_MS - 1;
  const FRESH = NOW - sweeper.JAMMED_ROW_MS + 60_000;

  const jammed = { status: "mirrored", updatedAt: new Date(OLD).toISOString() };
  assert.equal(sweeper.rowJammed(jammed, NOW), true, "no lease + old enough = jammed");

  const fresh = { status: "mirrored", updatedAt: new Date(FRESH).toISOString() };
  assert.equal(sweeper.rowJammed(fresh, NOW), false, "no lease but moved recently = not jammed");

  const withLease = { status: "mirrored", updatedAt: new Date(OLD).toISOString(), leaseToken: "t", leaseExpiresAt: new Date(NOW + 60_000).toISOString() };
  assert.equal(sweeper.rowJammed(withLease, NOW), false, "active lease = not jammed");

  const queued = { status: "queued", updatedAt: new Date(OLD).toISOString() };
  assert.equal(sweeper.rowJammed(queued, NOW), false, "terminal row (queued) = not jammed");
});

// ---------------------------------------------------------------------------
// Production incident 2026-08-25: inspection lane jammed (issue #384)
// ---------------------------------------------------------------------------
// 7 rows stuck in "inspecting" (status=mirrored), 1 ready (queued). The cron
// fired every 2 min but ZERO gate activity for 20+ minutes. The sweeper must
// resolve within 2 cron ticks (< 10 min), not 30 min.
// ---------------------------------------------------------------------------

test("inspection lane jam: 7 mirrored + 1 queued resolve within 2 cron ticks (< 10 min)", async () => {
  const INCIDENT_START = "2026-08-25T01:55:00.000Z";
  // Simulate the state at T+12 min: the batch moved 12 min ago (→ STALE),
  // all 7 mirrored rows stale >10 min, 1 queued row unaffected.
  const incidentNow = Date.parse(INCIDENT_START) + 12 * 60 * 1000;
  const nowIso = new Date(incidentNow).toISOString();

  const batch = lineState.newBatch({ batchId: "incident_384", lane: "live", target: "roofing in Denver CO", now: INCIDENT_START });
  batch.requested = 8;
  // 7 mirrored (stuck) rows
  for (let i = 0; i < 7; i += 1) {
    let row = lineState.newRow({ prospectId: `prospect_${i}`, businessName: `Biz ${i}`, city: "Denver", state: "CO", now: INCIDENT_START });
    row = lineState.advanceRow(row, "qualified", { now: INCIDENT_START }).row;
    row = lineState.advanceRow(row, "mirrored", { previewUrl: `https://prospect_${i}.wss-ai.com/`, now: INCIDENT_START }).row;
    batch.rows.push(row);
  }
  // 1 queued (ready) row
  {
    let row = lineState.newRow({ prospectId: "prospect_ready", businessName: "Biz Ready", city: "Denver", state: "CO", now: INCIDENT_START });
    row = lineState.advanceRow(row, "qualified", { now: INCIDENT_START }).row;
    row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://prospect_ready.wss-ai.com/", now: INCIDENT_START }).row;
    row = lineState.applyGate(row, { pass: true, failed: [], checks: [] }, { now: INCIDENT_START }).row;
    row = lineState.advanceRow(row, "queued", { previewUrl: row.previewUrl, now: INCIDENT_START }).row;
    batch.rows.push(row);
  }

  assert.equal(batch.rows.length, 8);
  assert.equal(batch.rows.filter((r) => r.status === "mirrored").length, 7);
  assert.equal(batch.rows.filter((r) => r.status === "queued").length, 1);

  const persisted = [];
  const events = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: (b) => { persisted.push(b); return b; },
    recordEvent: async (type, payload) => events.push({ type, payload }),
    now: incidentNow,
  });

  // Resolved in one sweep tick (= 2 cron ticks max).
  assert.equal(result.ok, true);
  assert.equal(result.examined, 1);

  const settled = persisted[0];
  assert.ok(settled, "batch was written");
  // 7 stuck rows are now terminal errors; 1 queued row is preserved.
  assert.equal(settled.status, "awaiting_approval", "owner can approve the cleared batch");
  const errored = settled.rows.filter((r) => r.status === "error");
  const ready = settled.rows.filter((r) => r.status === "queued");
  assert.equal(errored.length, 7, "all 7 stuck rows failed");
  assert.equal(ready.length, 1, "queued row is untouched");
  for (const row of errored) {
    assert.ok(row.reason.startsWith("inspection_timed_out"), `reason: ${row.reason}`);
  }

  // Audit event emitted for observability.
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "line.inspection_rows_timed_out");
  assert.equal(events[0].payload.failedRows, 7);
});

test("CONTROL inspection: mirrored rows that moved within 10 min are not failed", async () => {
  const BASE = "2026-08-25T01:55:00.000Z";
  // Only 9 min have passed — within STALE_INSPECTION_ROW_MS (10 min).
  const freshNow = Date.parse(BASE) + 9 * 60 * 1000;

  const batch = lineState.newBatch({ batchId: "fresh_inspect", lane: "sandbox", target: "roofing in Denver CO", now: BASE });
  let row = lineState.newRow({ prospectId: "p1", businessName: "Biz", city: "Denver", state: "CO", now: BASE });
  row = lineState.advanceRow(row, "qualified", { now: BASE }).row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://p1.wss-ai.com/", now: BASE }).row;
  batch.rows = [row];

  let persistCalls = 0;
  await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: () => { persistCalls += 1; },
    now: freshNow,
  });

  assert.equal(persistCalls, 0, "recent mirrored row must not be failed");
  assert.equal(batch.rows[0].status, "mirrored");
});

// Production incident 2026-08-27: mirror_build lane jammed (issue #459)
// ---------------------------------------------------------------------------
// 10 rows stuck in mirror_build (status="qualified"), 0 completed samples,
// 16 min elapsed. The Vercel deploy-poll hung or the browser pool exhausted
// under 10-wide concurrency — NOTHING freed them. The sweeper must resolve
// within 2 cron ticks (< 10 min), matching the same acceptance criteria as
// the inspection lane jam (#384 / #385).
// ---------------------------------------------------------------------------

test("mirror_build lane jam: 10 qualified rows resolve within 2 cron ticks (< 10 min)", async () => {
  const INCIDENT_START = "2026-08-27T09:00:00.000Z";
  // Simulate the state at T+12 min: batch moved 12 min ago (→ STALE),
  // all 10 qualified rows stale >10 min.
  const incidentNow = Date.parse(INCIDENT_START) + 12 * 60 * 1000;

  const batch = lineState.newBatch({ batchId: "incident_459", lane: "live", target: "hvac in Columbus OH", now: INCIDENT_START });
  batch.requested = 10;
  for (let i = 0; i < 10; i += 1) {
    let row = lineState.newRow({ prospectId: `prospect_${i}`, businessName: `Biz ${i}`, city: "Columbus", state: "OH", now: INCIDENT_START });
    row = lineState.advanceRow(row, "qualified", { now: INCIDENT_START }).row;
    batch.rows.push(row);
  }

  assert.equal(batch.rows.length, 10);
  assert.equal(batch.rows.filter((r) => r.status === "qualified").length, 10);

  const persisted = [];
  const events = [];
  const result = await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: (b) => { persisted.push(b); return b; },
    recordEvent: async (type, payload) => events.push({ type, payload }),
    now: incidentNow,
  });

  // Resolved in one sweep tick (= 2 cron ticks max).
  assert.equal(result.ok, true);
  assert.equal(result.examined, 1);

  const settled = persisted[0];
  assert.ok(settled, "batch was written");
  // All 10 stuck rows are now terminal errors.
  assert.equal(settled.status, "done", "no queued rows → done");
  const errored = settled.rows.filter((r) => r.status === "error");
  assert.equal(errored.length, 10, "all 10 stuck rows failed");
  for (const row of errored) {
    assert.ok(row.reason.startsWith("mirror_build_timed_out"), `reason: ${row.reason}`);
  }

  // Audit event emitted for observability.
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "line.mirror_build_rows_timed_out");
  assert.equal(events[0].payload.failedRows, 10);
});

test("mirror_build lane jam: 10 qualified + 1 queued resolve with queued row preserved", async () => {
  const INCIDENT_START = "2026-08-27T09:00:00.000Z";
  const incidentNow = Date.parse(INCIDENT_START) + 12 * 60 * 1000;

  const batch = lineState.newBatch({ batchId: "incident_459b", lane: "live", target: "plumbing in Phoenix AZ", now: INCIDENT_START });
  batch.requested = 11;
  for (let i = 0; i < 10; i += 1) {
    let row = lineState.newRow({ prospectId: `pb_${i}`, businessName: `Biz ${i}`, city: "Phoenix", state: "AZ", now: INCIDENT_START });
    row = lineState.advanceRow(row, "qualified", { now: INCIDENT_START }).row;
    batch.rows.push(row);
  }
  // 1 already-queued (approvable) row
  {
    let row = lineState.newRow({ prospectId: "pb_ready", businessName: "Biz Ready", city: "Phoenix", state: "AZ", now: INCIDENT_START });
    row = lineState.advanceRow(row, "qualified", { now: INCIDENT_START }).row;
    row = lineState.advanceRow(row, "mirrored", { previewUrl: "https://pb_ready.wss-ai.com/", now: INCIDENT_START }).row;
    row = lineState.applyGate(row, { pass: true, failed: [], checks: [] }, { now: INCIDENT_START }).row;
    row = lineState.advanceRow(row, "queued", { previewUrl: row.previewUrl, now: INCIDENT_START }).row;
    batch.rows.push(row);
  }

  const persisted = [];
  const events = [];
  await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: (b) => { persisted.push(b); return b; },
    recordEvent: async (type, payload) => events.push({ type, payload }),
    now: incidentNow,
  });

  const settled = persisted[0];
  assert.ok(settled, "batch was written");
  assert.equal(settled.status, "awaiting_approval", "queued site is approvable");
  const errored = settled.rows.filter((r) => r.status === "error");
  const ready = settled.rows.filter((r) => r.status === "queued");
  assert.equal(errored.length, 10, "all 10 stuck build rows failed");
  assert.equal(ready.length, 1, "queued row is untouched");

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "line.mirror_build_rows_timed_out");
  assert.equal(events[0].payload.failedRows, 10);
});

test("CONTROL mirror_build: qualified rows that moved within 10 min are not failed", async () => {
  const BASE = "2026-08-27T09:00:00.000Z";
  // Only 9 min have passed — within STALE_INSPECTION_ROW_MS (10 min).
  const freshNow = Date.parse(BASE) + 9 * 60 * 1000;

  const batch = lineState.newBatch({ batchId: "fresh_build", lane: "sandbox", target: "hvac in Denver CO", now: BASE });
  for (let i = 0; i < 10; i += 1) {
    let row = lineState.newRow({ prospectId: `fp_${i}`, businessName: `Biz ${i}`, city: "Denver", state: "CO", now: BASE });
    row = lineState.advanceRow(row, "qualified", { now: BASE }).row;
    batch.rows.push(row);
  }

  let persistCalls = 0;
  await sweeper.sweepLineBatches({
    listBatches: () => [batch],
    putBatch: () => { persistCalls += 1; },
    now: freshNow,
  });

  assert.equal(persistCalls, 0, "recent qualified rows must not be failed");
  assert.equal(batch.rows.every((r) => r.status === "qualified"), true);
});
