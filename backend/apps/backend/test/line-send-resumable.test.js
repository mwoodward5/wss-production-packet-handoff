"use strict";
// A four-row batch once ran past the 300s function ceiling and returned 504
// having sent nothing: every approved row was walked in one invocation, and
// each send re-captures proof shots through Chromium. These lock in that a
// pass is bounded, that what it did send is recorded, and — the part that
// actually bites — that a partial pass does NOT call itself done and strand
// the rest of the queue.
const test = require("node:test");
const assert = require("node:assert");
const runner = require("../lib/line-runner");

function approvedBatch(n) {
  const rows = Array.from({ length: n }, (_, i) => ({
    prospectId: `p${i}`,
    businessName: `Biz ${i}`,
    status: "queued",
    previewUrl: `https://p${i}.wss-ai.com/`,
    // A queued row without a passing gate is refused by assertSendAuthorized —
    // that guard is the point, so the fixture satisfies it honestly.
    gate: { pass: true },
    history: [],
  }));
  const batch = {
    batchId: `line_test_${n}`,
    lane: "sandbox",
    target: "",
    requested: n,
    status: "approved",
    rows,
    approval: {
      actor: "test",
      at: new Date().toISOString(),
      typedBatchId: `line_test_${n}`,
      approvedRows: n,
    },
  };
  runner.putBatch(batch);
  return batch;
}

test("a bounded pass sends only its limit and leaves the rest queued", async () => {
  const batch = approvedBatch(4);
  const seen = [];
  const res = await runner.sendApprovedBatch(batch.batchId, {
    limit: 2,
    send: async (row) => { seen.push(row.prospectId); return { ok: true }; },
  });
  assert.equal(res.ok, true);
  assert.equal(seen.length, 2, "sent more rows than the limit allowed");
  assert.equal(res.sent, 2);
  assert.equal(res.remaining, 2, "the untouched rows must stay sendable");
  assert.equal(runner.getBatch(batch.batchId).status, "approved",
    "a partial pass that reports done strands the rest of the queue");
});

test("a time budget stops before starting a send it cannot finish", async () => {
  const batch = approvedBatch(6);
  let calls = 0;
  const res = await runner.sendApprovedBatch(batch.batchId, {
    budgetMs: 120,
    startedAt: Date.now(),
    send: async () => { calls += 1; await new Promise((r) => setTimeout(r, 60)); return { ok: true }; },
  });
  assert.ok(calls < 6, `budget ignored — all ${calls} rows ran`);
  assert.ok(calls >= 1, "budget was so tight nothing ran; that is a stall, not a bound");
  assert.equal(res.remaining, 6 - res.sent);
  assert.equal(runner.getBatch(batch.batchId).status, "approved");
});

test("successive passes drain the batch and only then is it done", async () => {
  const batch = approvedBatch(5);
  let total = 0;
  let guard = 0;
  let last = null;
  do {
    last = await runner.sendApprovedBatch(batch.batchId, {
      limit: 2,
      send: async () => { total += 1; return { ok: true }; },
    });
    guard += 1;
  } while (last.remaining > 0 && guard < 10);

  assert.equal(total, 5, "every approved row must eventually send exactly once");
  assert.equal(last.remaining, 0);
  assert.equal(runner.getBatch(batch.batchId).status, "done");
});

test("a refused send is recorded as a failure and the pass still completes", () => {
  // Deliberately NOT asserting that a refusal removes the row: a send refused
  // for missing proof shots may well succeed once those exist, so leaving it
  // queued is correct. What must not happen is the refusal being silently
  // counted as a send.
  const batch = approvedBatch(2);
  return runner.sendApprovedBatch(batch.batchId, {
    send: async () => ({ ok: false, reason: "no_before_after_visuals" }),
  }).then((res) => {
    assert.equal(res.sent, 0, "a refusal must never count as a send");
    assert.equal(res.failures.length, 2);
    assert.equal(res.attempted, 2);
  });
});

// NOT TESTED HERE, DELIBERATELY, AND WORTH KNOWING.
//
// sendApprovedBatch now calls putBatch(batch) immediately after each successful
// send. That exists because of the Cooper Perry case: the first production
// batch ran past the 300s function ceiling, the platform killed it mid-loop,
// and because row state was only persisted after the WHOLE loop, the rows it
// had already emailed were still "queued" when the next invocation read the
// durable store — so one prospect received the same cold email twice.
//
// Two honest reasons there is no test for it:
//   1. getBatch() returns the same in-memory object advanceRow already mutated,
//      so inside one process the row reads "sent" whether or not anything was
//      persisted. The defect only exists across a process boundary.
//   2. putBatch is called as a direct internal reference, so patching the
//      export does not intercept it; proving the call would mean reshaping the
//      module purely to be observable.
//
// So this guarantee currently rests on reading the code, not on a test that
// fails when it regresses. Making putBatch injectable through deps (as `send`
// and `now` already are) would close that, and is the right next step for
// anyone touching this function.
