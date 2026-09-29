"use strict";

// test/batch-recovery.test.js
//
// The batch registry is a Map inside one lambda. An operator who starts a run,
// steps away while it builds, and comes back to click Approve can land on a
// fresh instance — and be told "unknown_batch" about a batch that built
// perfectly. It happened repeatedly during this session's live runs; the
// workaround was to chain start/approve/send fast enough to stay on one warm
// instance, which is not something an operator should have to know.
//
// Recovery is ADDITIVE: the in-process hit path is untouched and is still what
// answers almost every call. Only a miss reaches for the durable snapshot.

const test = require("node:test");
const assert = require("node:assert");
const runner = require("../lib/line-runner");

test("a batch still in memory is returned without touching the store", async () => {
  runner.resetBatches();
  const batch = { batchId: "line_inmem_1", startedAt: "2026-08-06T00:00:00Z", rows: [] };
  runner.__testables.putBatch(batch);
  assert.equal(runner.getBatch("line_inmem_1"), batch);
  assert.equal(await runner.recoverBatch("line_inmem_1"), batch, "a live batch must not require recovery");
});

test("a batch lost with its lambda is recovered from the durable snapshot", async () => {
  runner.resetBatches();
  assert.equal(runner.getBatch("line_lost_1"), null, "precondition: not in memory");

  const snapshot = {
    payload: { batchId: "line_lost_1", batch: { batchId: "line_lost_1", status: "awaiting_approval", rows: [{ prospectId: "p1" }] } },
  };
  const recovered = await runner.recoverBatch("line_lost_1", {
    selectRows: async () => ({ rows: [snapshot] }),
  });
  assert.ok(recovered, "a snapshotted batch must come back");
  assert.equal(recovered.batchId, "line_lost_1");
  assert.equal(recovered.status, "awaiting_approval");
  assert.equal(runner.getBatch("line_lost_1").batchId, "line_lost_1", "recovery must re-seat it in the registry");
});

test("an unknown id recovers to null rather than inventing a batch", async () => {
  runner.resetBatches();
  assert.equal(await runner.recoverBatch("line_never_existed"), null);
  assert.equal(await runner.recoverBatch(""), null);
  assert.equal(await runner.recoverBatch(null), null);
});

// ---------------------------------------------------------------------------
// THE NOISY LOG, AGAIN. listBatchesDurable already learned this lesson
// (one active batch writes snapshots by the hundred, so a fixed newest-N
// window shows only that batch) — but recoverBatch kept its own newest-40
// read. Measured on production, 2026-08-11, on the owner's own approve-all
// run at /campaigns: the six swept hvac batches' settle snapshots sat just
// below the newest sends' snapshots, so approve answered 404 unknown_batch
// for Columbus and Portland immediately — and then EVERY campaign that did
// send buried the next one deeper, so Reno 404'd too. The recovery read must
// ask the store for THIS batch's snapshot (payload->>batchId), and when a
// store shim cannot filter on the payload it must page backwards like
// listBatchesDurable instead of giving up at an arbitrary depth.
// ---------------------------------------------------------------------------

/** A store stub that behaves like PostgREST over ghost_agency_events:
 *  honors type + created_at=lt. cursors + order created_at.desc + limit, and
 *  (unless told to reject it) the payload->>batchId equality filter. */
function eventStore(events, { rejectPayloadFilter = false } = {}) {
  const calls = [];
  const read = async (table, options = {}) => {
    assert.equal(table, "ghost_agency_events");
    calls.push(options);
    const clauses = {};
    for (const clause of String(options.filter || "").split("&")) {
      const eq = clause.indexOf("=");
      if (eq > 0) clauses[clause.slice(0, eq)] = decodeURIComponent(clause.slice(eq + 1));
    }
    assert.equal(clauses.type, "eq.line.batch", "recovery must never scan other event types");
    let rows = events.slice();
    const byId = clauses["payload->>batchId"];
    if (byId !== undefined) {
      if (rejectPayloadFilter) { const e = new Error("payload filter unsupported"); e.status = 400; throw e; }
      rows = rows.filter((r) => String((r.payload || {}).batchId) === byId.replace(/^eq\./, ""));
    }
    if (clauses.created_at && clauses.created_at.startsWith("lt.")) {
      const cursor = clauses.created_at.slice(3);
      rows = rows.filter((r) => r.created_at < cursor);
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (options.limit) rows = rows.slice(0, Number(options.limit));
    return { ok: true, rows };
  };
  return { read, calls };
}

function buriedLog(noise = 250) {
  // `noise` snapshots of ONE chatty batch, every one newer than the single
  // snapshot of the batch the operator is trying to approve. 250 > one page,
  // so the paged fallback must actually use its cursor to reach it.
  const base = Date.parse("2026-08-11T07:00:00.000Z");
  const events = [];
  for (let i = 0; i < noise; i += 1) {
    events.push({
      created_at: new Date(base - i * 1000).toISOString(),
      payload: { batchId: "line_chatty", batch: { batchId: "line_chatty", status: "sending", rows: [] } },
    });
  }
  events.push({
    created_at: "2026-08-11T05:00:00.000Z",
    payload: {
      batchId: "line_buried_1",
      batch: { batchId: "line_buried_1", status: "awaiting_approval", rows: [{ prospectId: "p9", status: "queued" }] },
    },
  });
  return events;
}

test("a snapshot buried under a noisy log is still recovered (payload-filtered read)", async () => {
  runner.resetBatches();
  const store = eventStore(buriedLog());
  const recovered = await runner.recoverBatch("line_buried_1", { selectRows: store.read });
  assert.ok(recovered, "the settle snapshot exists in the store — a deeper log must not turn it into unknown_batch");
  assert.equal(recovered.batchId, "line_buried_1");
  assert.equal(recovered.status, "awaiting_approval");
  assert.equal(runner.getBatch("line_buried_1").batchId, "line_buried_1", "recovery must re-seat it in the registry");
});

test("recovery pages backwards when the store cannot filter on the payload", async () => {
  runner.resetBatches();
  const store = eventStore(buriedLog(), { rejectPayloadFilter: true });
  const recovered = await runner.recoverBatch("line_buried_1", { selectRows: store.read });
  assert.ok(recovered, "a store that rejects payload filters must fall back to paging, not 404");
  assert.equal(recovered.batchId, "line_buried_1");
  const paged = store.calls.filter((c) => String(c.filter || "").includes("created_at=lt."));
  assert.ok(paged.length >= 1, "the fallback must actually page past the first window");
});
