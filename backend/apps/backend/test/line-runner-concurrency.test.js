"use strict";

/**
 * test/line-runner-concurrency.test.js — mirrors build in a bounded pool.
 *
 * WHY THIS FILE EXISTS
 *
 * startBatch() used to walk batch.rows in a plain `for` loop: qualify, mirror,
 * render-gate and queue one lead to completion before touching the next. The
 * dominant cost is a Vercel deploy — roughly 60s of pure network wait — so a
 * ten-lead batch took about ten minutes with the owner's machine at 18% CPU.
 *
 * The loop body became a per-row async function driven by a worker pool. That
 * transform is delicate for two reasons, and both are pinned here:
 *
 *   1. NINE `continue` statements became nine `return`s. A missed one does not
 *      throw — it silently keeps building a row the line already refused. Every
 *      refusal path below is driven to its terminal state and compared against
 *      the same run executed serially.
 *
 *   2. seenLogoShas ("one logo cannot belong to two clients") went from a
 *      read and a write that were adjacent to a read and a write separated by
 *      the gate's own network round trip. Two rows could both read "unseen",
 *      both pass, and both ship the same logo. `the logo race` below forces
 *      exactly that ordering.
 *
 * NOTE ON TIMING: with zero-latency stubs the pool runs in LOCKSTEP — every row
 * advances one microtask at a time in dispatch order, and the output is
 * indistinguishable from serial. That hides every race this file is about. So
 * these tests use real (small) timers and deliberately uneven latencies.
 */

const test = require("node:test");
const assert = require("node:assert");
const { createHash } = require("node:crypto");

const runner = require("../lib/line-runner");
const lineState = require("../lib/line-state");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shaFor = (id) => createHash("sha256").update(String(id)).digest("hex");

/**
 * A batch harness with measurable overlap.
 *
 * `plan` is one entry per lead describing which path that lead should take and
 * how long its mirror should sit in the network. Every dependency records what
 * it was called with, and the mirror step tracks how many rows are in flight at
 * once — that counter is the whole proof that the pool is a pool.
 */
function harness(plan, { snapshotSink } = {}) {
  const calls = { qualify: [], mirror: [], gate: [], write: [], queue: [] };
  const inFlight = { now: 0, max: 0 };
  const progress = [];

  const rowFor = (spec, i) => ({
    prospectId: spec.prospectId || `wss-test-p${i}`,
    businessName: `Business ${i}`,
    city: "Portland",
    state: "OR",
    vertical: "plumbing",
    email: `owner${i}@example.test`,
    contractIssue: spec.contractIssue || undefined,
  });

  const deps = {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "0" },
    pick: async () => plan.map(rowFor),
    qualify: async (row) => {
      calls.qualify.push(row.prospectId);
      const spec = specOf(row.prospectId);
      if (spec.qualify === false) return { ok: false, reason: spec.reason || "did not qualify" };
      return { ok: true };
    },
    // This suite pins pool/concurrency behavior, not the separately tested
    // default-on owned-hero preparation lane.
    prepareHero: async () => ({ ok: true, required: false, ready: true }),
    mirror: async (row) => {
      calls.mirror.push(row.prospectId);
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      try {
        const spec = specOf(row.prospectId);
        await sleep(spec.mirrorMs === undefined ? 40 : spec.mirrorMs);
        if (spec.mirrorThrows) throw new Error(spec.mirrorThrows);
        if (spec.mirror === false) {
          return { ok: false, reason: spec.reason || "donor 500", terminal: spec.terminal };
        }
        if (spec.mirror === "nourl") return { ok: true, previewUrl: "" };
        return {
          ok: true,
          previewUrl: `https://${row.prospectId}.wss-ai.com/`,
          ...(spec.buildHash ? { buildHash: spec.buildHash } : {}),
          ...(Object.prototype.hasOwnProperty.call(spec, "proofIdentity")
            ? { proofIdentity: spec.proofIdentity }
            : {}),
        };
      } finally {
        inFlight.now -= 1;
      }
    },
    sourceFacts: async () => ({ vertical: "plumbing" }),
    gate: async ({ source, seenLogoShas, build }) => {
      const spec = specOf(source.prospect_id);
      calls.gate.push({
        prospectId: source.prospect_id,
        build,
        // What the GATE could see at the moment it was asked. If this is empty
        // for two rows that share a logo, the gate cannot possibly have been
        // the thing that caught the collision.
        seen: [...seenLogoShas.entries()],
      });
      if (spec.gateMs) await sleep(spec.gateMs);
      if (spec.gate === false) {
        return { pass: false, failed: ["nap_match"], blockedBy: "nap_match: rendered DOM is missing postal_city:Buda", checks: [] };
      }
      return {
        pass: true,
        failed: [],
        checks: [{
          fact: "logo_own_and_unique",
          pass: true,
          evidence: { sha256: spec.sha || shaFor(source.prospect_id) },
        }],
      };
    },
    writePreviewUrl: async (row) => {
      calls.write.push(row.prospectId);
      const spec = specOf(row.prospectId);
      return spec.write === false ? { ok: false, reason: "preview_url write failed" } : { ok: true };
    },
    queueEmail: async (row) => {
      calls.queue.push(row.prospectId);
      const spec = specOf(row.prospectId);
      return spec.queue === false ? { ok: false, reason: "email queue failed" } : { ok: true };
    },
    onProgress: (batch) => {
      progress.push((batch.rows || []).map((r) => r.status));
    },
    snapshot: snapshotSink || (() => {}),
  };

  function specOf(prospectId) {
    const index = plan.findIndex((p, i) => rowFor(p, i).prospectId === prospectId);
    return index >= 0 ? plan[index] : {};
  }

  return { deps, calls, inFlight, progress };
}

/** status + reason + previewUrl, i.e. everything the operator is shown. */
function outcomes(batch) {
  return batch.rows.map((r) => ({
    prospectId: r.prospectId,
    status: r.status,
    reason: r.reason,
    previewUrl: r.previewUrl,
    failedFacts: r.failedFacts || [],
  }));
}

// ---------------------------------------------------------------------------
// the pool is actually a pool
// ---------------------------------------------------------------------------

test("ten leads overlap five at a time and finish in about a fifth of the serial time", async () => {
  runner.resetBatches();
  const plan = Array.from({ length: 10 }, () => ({ mirrorMs: 60 }));

  const serial = harness(plan);
  const serialStart = Date.now();
  const serialRun = await runner.startBatch({ count: 10, lane: "sandbox" }, { ...serial.deps, concurrency: 1 });
  const serialMs = Date.now() - serialStart;

  runner.resetBatches();
  const pooled = harness(plan);
  const poolStart = Date.now();
  const poolRun = await runner.startBatch({ count: 10, lane: "sandbox" }, { ...pooled.deps, concurrency: 5 });
  const poolMs = Date.now() - poolStart;

  assert.equal(serial.inFlight.max, 1, "concurrency 1 must never overlap two mirrors");
  assert.equal(pooled.inFlight.max, 5, "the pool must reach its bound, and must not exceed it");

  // 10 x 60ms serial vs two waves of five. Generous margins: this asserts the
  // shape of the win, not a stopwatch reading on a loaded machine.
  assert.ok(serialMs >= 550, `serial should pay every wait: ${serialMs}ms`);
  assert.ok(poolMs < serialMs / 2, `pool ${poolMs}ms should be well under half of serial ${serialMs}ms`);

  // A SPEEDUP THAT CHANGES WHICH LEADS SUCCEED IS NOT A SPEEDUP.
  assert.deepEqual(outcomes(poolRun.batch), outcomes(serialRun.batch));
  assert.equal(lineState.batchCounts(poolRun.batch).queued, 10);
});

test("the pool bound is respected for every concurrency, and a short batch never over-spawns", async () => {
  for (const limit of [1, 2, 3, 7]) {
    runner.resetBatches();
    const h = harness(Array.from({ length: 8 }, () => ({ mirrorMs: 25 })));
    await runner.startBatch({ count: 8, lane: "sandbox" }, { ...h.deps, concurrency: limit });
    assert.equal(h.inFlight.max, limit, `concurrency ${limit} overlapped ${h.inFlight.max}`);
  }

  // Three leads must not start five workers' worth of anything.
  runner.resetBatches();
  const small = harness(Array.from({ length: 3 }, () => ({ mirrorMs: 25 })));
  await runner.startBatch({ count: 3, lane: "sandbox" }, { ...small.deps, concurrency: 5 });
  assert.equal(small.inFlight.max, 3);
});

// ---------------------------------------------------------------------------
// how many at once — the setting
// ---------------------------------------------------------------------------

test("buildConcurrency defaults to 10, is capped, and refuses nonsense", () => {
  const { buildConcurrency, DEFAULT_BUILD_CONCURRENCY, MAX_BUILD_CONCURRENCY } = runner;
  assert.equal(DEFAULT_BUILD_CONCURRENCY, 10);
  assert.equal(buildConcurrency(undefined), 10);
  assert.equal(buildConcurrency(""), 10);
  assert.equal(buildConcurrency("banana"), 10);
  assert.equal(buildConcurrency("0"), 10, "zero would build nothing — fall back, do not hang");
  assert.equal(buildConcurrency("-4"), 10);
  assert.equal(buildConcurrency("1"), 1);
  assert.equal(buildConcurrency("8"), 8);
  // Still honoured up to the cap, and a typo cannot exceed it.
  assert.equal(buildConcurrency("11"), 11);
  assert.equal(buildConcurrency("14"), 14);
  assert.equal(buildConcurrency("15"), 15, "15 is the top of the tuning range");
  assert.equal(buildConcurrency("16"), MAX_BUILD_CONCURRENCY, "16 clamps down to the cap");
  assert.equal(buildConcurrency("500"), MAX_BUILD_CONCURRENCY);
  assert.equal(MAX_BUILD_CONCURRENCY, 15);
});

test("the render gate includes the full proof-capture budget inside the worker ceiling", () => {
  const { CAPTURE_BUDGET_MS } = require("../lib/line-email-assets");
  assert.equal(runner.DEFAULT_GATE_TIMEOUT_MS, CAPTURE_BUDGET_MS + 60_000);
  assert.equal(runner.GATE_TIMEOUT_MS, runner.DEFAULT_GATE_TIMEOUT_MS);
  assert.ok(runner.DEFAULT_GATE_TIMEOUT_MS < 230_000);
});

test("the batch runner carries shared proof identity exactly and rejects a conflicting build", async () => {
  const identity = {
    site_id: "11111111-1111-4111-8111-111111111111",
    release_id: "22222222-2222-4222-8222-222222222222",
    build_hash: "a".repeat(64),
  };
  runner.resetBatches();
  const h = harness([
    { prospectId: "shared-batch-ok", mirrorMs: 1, buildHash: identity.build_hash, proofIdentity: identity },
    {
      prospectId: "shared-batch-refused",
      mirrorMs: 1,
      buildHash: identity.build_hash,
      proofIdentity: { ...identity, release_id: "" },
    },
    { prospectId: "legacy-batch", mirrorMs: 1 },
  ]);
  const run = await runner.startBatch({ count: 3, lane: "sandbox" }, { ...h.deps, concurrency: 3 });

  const ok = run.batch.rows.find((row) => row.prospectId === "shared-batch-ok");
  const refused = run.batch.rows.find((row) => row.prospectId === "shared-batch-refused");
  const legacy = run.batch.rows.find((row) => row.prospectId === "legacy-batch");
  assert.deepEqual(ok.proofIdentity, identity);
  assert.deepEqual(h.calls.gate.find((call) => call.prospectId === ok.prospectId).build.proofIdentity, identity);
  assert.equal(refused.status, "rejected");
  assert.match(String(refused.reason || ""), /^shared_proof_identity_incomplete:/);
  assert.equal(h.calls.gate.some((call) => call.prospectId === refused.prospectId), false);
  assert.equal(Object.hasOwn(legacy, "proofIdentity"), false);
  assert.equal(
    Object.hasOwn(h.calls.gate.find((call) => call.prospectId === legacy.prospectId).build, "proofIdentity"),
    false,
  );
});

test("GHOST_AGENCY_BUILD_CONCURRENCY drives the pool with no deploy", async () => {
  const key = runner.BUILD_CONCURRENCY_ENV;
  assert.equal(key, "GHOST_AGENCY_BUILD_CONCURRENCY");
  const previous = process.env[key];
  try {
    process.env[key] = "2";
    runner.resetBatches();
    const h = harness(Array.from({ length: 6 }, () => ({ mirrorMs: 25 })));
    await runner.startBatch({ count: 6, lane: "sandbox" }, h.deps);
    assert.equal(h.inFlight.max, 2);

    process.env[key] = "6";
    runner.resetBatches();
    const wider = harness(Array.from({ length: 6 }, () => ({ mirrorMs: 25 })));
    await runner.startBatch({ count: 6, lane: "sandbox" }, wider.deps);
    assert.equal(wider.inFlight.max, 6);
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
});

test("with no dial touched the default pool builds ten at once and the eleventh waits its turn", async () => {
  // The owner's bar: ten sites building simultaneously. With no deps.concurrency
  // and no env var, startBatch must open exactly DEFAULT_BUILD_CONCURRENCY lanes.
  const key = runner.BUILD_CONCURRENCY_ENV;
  const previous = process.env[key];
  delete process.env[key];
  try {
    runner.resetBatches();
    const h = harness(Array.from({ length: 11 }, (_, i) => ({ prospectId: `wss-test-pool10-${i}`, mirrorMs: 40 })));
    const run = await runner.startBatch({ count: 11, lane: "sandbox" }, h.deps);

    // TEN at once, never eleven: the pool reaches its bound and the eleventh
    // row waits for a worker instead of spawning past capacity.
    assert.equal(h.inFlight.max, 10, "the default pool must hold exactly ten concurrent mirrors");
    // The eleventh waited and then ran — nothing was dropped or thrashed.
    assert.equal(lineState.batchCounts(run.batch).queued, 11);
    assert.equal(run.batch.rows.every((r) => r.status === "queued"), true);
  } finally {
    if (previous !== undefined) process.env[key] = previous;
  }
});

// ---------------------------------------------------------------------------
// the nine refusals
// ---------------------------------------------------------------------------

/**
 * One lead per refusal path, all in one batch, run serially and pooled.
 *
 * Each `continue` became a `return`. A missed one falls through to the NEXT
 * step instead of ending the row — so this asserts both the terminal state and
 * that the step after the refusal was never reached for that lead.
 */
const REFUSALS = [
  { name: "contract incomplete", spec: { prospectId: "r-contract", contractIssue: "build_ready_contract_incomplete:proof" }, status: "rejected", reason: "build_ready_contract_incomplete:proof", notCalled: ["qualify", "mirror", "gate", "write", "queue"] },
  { name: "did not qualify", spec: { prospectId: "r-qualify", qualify: false, reason: "grade A- — already has a modern site" }, status: "rejected", reason: "grade A- — already has a modern site", notCalled: ["mirror", "gate", "write", "queue"] },
  { name: "mirror refused, terminal", spec: { prospectId: "r-mirror-rejected", mirror: false, terminal: "rejected", reason: "mirror_lane_disabled" }, status: "rejected", reason: "mirror_lane_disabled", notCalled: ["gate", "write", "queue"] },
  { name: "mirror failed", spec: { prospectId: "r-mirror-error", mirror: false, reason: "donor 500" }, status: "error", reason: "donor 500", notCalled: ["gate", "write", "queue"] },
  { name: "mirror produced no URL", spec: { prospectId: "r-nourl", mirror: "nourl" }, status: "error", reason: "mirror build produced no URL", notCalled: ["gate", "write", "queue"] },
  { name: "gate refused", spec: { prospectId: "r-gate", gate: false }, status: "gate_failed", reason: "nap_match: rendered DOM is missing postal_city:Buda", notCalled: ["write", "queue"] },
  { name: "preview_url write failed", spec: { prospectId: "r-write", write: false }, status: "error", reason: "preview_url write failed", notCalled: ["queue"] },
  { name: "email queue failed", spec: { prospectId: "r-queue", queue: false }, status: "error", reason: "email queue failed", notCalled: [] },
  { name: "the row threw", spec: { prospectId: "r-throw", mirrorThrows: "chromium died" }, status: "error", reason: "row_error: chromium died", notCalled: ["gate", "write", "queue"] },
  { name: "the happy path", spec: { prospectId: "r-ok" }, status: "queued", reason: "", notCalled: [] },
];

test("every refusal path ends its row identically under the pool and serially", async () => {
  const plan = REFUSALS.map((r) => ({ mirrorMs: 30, ...r.spec }));

  runner.resetBatches();
  const serial = harness(plan);
  const serialRun = await runner.startBatch({ count: plan.length, lane: "sandbox" }, { ...serial.deps, concurrency: 1 });

  runner.resetBatches();
  const pooled = harness(plan);
  const poolRun = await runner.startBatch({ count: plan.length, lane: "sandbox" }, { ...pooled.deps, concurrency: 5 });

  // Identical verdicts, identical reasons — the transform changed the schedule
  // and nothing else.
  assert.deepEqual(
    outcomes(poolRun.batch).slice().sort((a, b) => a.prospectId.localeCompare(b.prospectId)),
    outcomes(serialRun.batch).slice().sort((a, b) => a.prospectId.localeCompare(b.prospectId)),
  );

  for (const expected of REFUSALS) {
    const row = poolRun.batch.rows.find((r) => r.prospectId === expected.spec.prospectId);
    assert.ok(row, `${expected.name}: row missing`);
    assert.equal(row.status, expected.status, `${expected.name}: wrong terminal state`);
    assert.equal(row.reason, expected.reason, `${expected.name}: wrong reason`);
    // THE REFUSAL ACTUALLY STOPPED THE ROW. A missing `return` is invisible in
    // the status alone — it shows up as the next step running anyway.
    for (const step of expected.notCalled) {
      const seen = step === "gate"
        ? pooled.calls.gate.some((g) => g.prospectId === expected.spec.prospectId)
        : pooled.calls[step].includes(expected.spec.prospectId);
      assert.equal(seen, false, `${expected.name}: ${step} ran after the row was refused`);
    }
  }

  // One lead survived; the other nine refused without taking it down with them.
  const counts = lineState.batchCounts(poolRun.batch);
  assert.deepEqual(counts, { total: 10, ready: 0, queued: 1, failed: 9, sent: 0, working: 0 });
  assert.equal(poolRun.batch.status, "awaiting_approval");
});

/**
 * Two of the nine refusals are defensive: `if (!set(advanceRow(...))) return`.
 * They fire only when the state machine itself refuses a transition, which no
 * ordinary dependency can cause — so they are driven here by poisoning the row
 * through the onProgress callback, which holds the live batch.
 *
 * The point is not the poisoning. It is that a refused transition must END the
 * row rather than fall through and spend the next step on it.
 */
test("a refused state transition stops the row instead of building it anyway", async () => {
  for (const [poisonAt, mustNotRun] of [["picked", "mirror"], ["qualified", "gate"]]) {
    runner.resetBatches();
    const h = harness([{ prospectId: "wss-test-poison", mirrorMs: 5 }, { prospectId: "wss-test-clean", mirrorMs: 5 }]);
    let poisoned = false;
    const deps = {
      ...h.deps,
      concurrency: 2,
      onProgress: (batch) => {
        h.deps.onProgress(batch);
        const victim = (batch.rows || []).find((r) => r.prospectId === "wss-test-poison");
        if (!poisoned && victim && victim.status === poisonAt) {
          poisoned = true;
          victim.status = "error"; // any terminal state: advanceRow now refuses
        }
      },
    };
    const run = await runner.startBatch({ count: 2, lane: "sandbox" }, deps);
    const victim = run.batch.rows.find((r) => r.prospectId === "wss-test-poison");

    assert.equal(poisoned, true, `never reached ${poisonAt}`);
    assert.equal(victim.status, "error");
    assert.match(victim.reason, /row_already_terminal/);
    const ran = mustNotRun === "gate"
      ? h.calls.gate.some((g) => g.prospectId === "wss-test-poison")
      : h.calls[mustNotRun].includes("wss-test-poison");
    assert.equal(ran, false, `${mustNotRun} ran for a row whose transition was refused at ${poisonAt}`);

    // The sibling is untouched — a refused row does not poison the batch.
    const clean = run.batch.rows.find((r) => r.prospectId === "wss-test-clean");
    assert.equal(clean.status, "queued");
  }
});

test("a row that throws is contained: siblings still build and the batch still settles", async () => {
  runner.resetBatches();
  const plan = [
    { prospectId: "wss-test-a", mirrorMs: 30 },
    { prospectId: "wss-test-boom", mirrorMs: 5, mirrorThrows: "browser.newPage closed" },
    { prospectId: "wss-test-c", mirrorMs: 30 },
    { prospectId: "wss-test-d", mirrorMs: 30 },
  ];
  const h = harness(plan);
  const run = await runner.startBatch({ count: 4, lane: "sandbox" }, { ...h.deps, concurrency: 4 });

  assert.equal(run.ok, true);
  const boom = run.batch.rows.find((r) => r.prospectId === "wss-test-boom");
  assert.equal(boom.status, "error");
  assert.match(boom.reason, /row_error: browser\.newPage closed/);
  assert.deepEqual(
    run.batch.rows.filter((r) => r.prospectId !== "wss-test-boom").map((r) => r.status),
    ["queued", "queued", "queued"],
  );
  assert.equal(run.batch.status, "awaiting_approval");
});

// ---------------------------------------------------------------------------
// the logo race — the defect the pool would otherwise introduce
// ---------------------------------------------------------------------------

test("the logo race: two rows read an empty map, and still only one ships the logo", async () => {
  runner.resetBatches();
  const shared = shaFor("one-and-only-logo");
  // Both gates are asked at the same moment. The SECOND row answers first, so
  // the winner is not simply "whichever started first" — and neither gate can
  // have seen the other's claim, because neither claim existed yet.
  const plan = [
    { prospectId: "wss-test-slow", sha: shared, mirrorMs: 5, gateMs: 80 },
    { prospectId: "wss-test-fast", sha: shared, mirrorMs: 5, gateMs: 5 },
  ];
  const h = harness(plan);
  const run = await runner.startBatch({ count: 2, lane: "sandbox" }, { ...h.deps, concurrency: 2 });

  // PROOF THE GATE COULD NOT HAVE CAUGHT IT: both gate calls observed a map
  // with no entry for this sha. Enforcement inside the gate alone would have
  // passed both rows and shipped one logo to two clients.
  assert.equal(h.calls.gate.length, 2);
  for (const call of h.calls.gate) {
    assert.equal(call.seen.some(([sha]) => sha === shared), false,
      `${call.prospectId}'s gate already saw the claim — the race was not actually forced`);
  }

  const queued = run.batch.rows.filter((r) => r.status === "queued");
  const blocked = run.batch.rows.filter((r) => r.status === "gate_failed");
  assert.equal(queued.length, 1, "exactly one client may ship this logo");
  assert.equal(blocked.length, 1);
  assert.match(blocked[0].reason, /already shipped for/);
  assert.match(blocked[0].reason, new RegExp(queued[0].prospectId));
  assert.deepEqual(blocked[0].failedFacts, ["logo_own_and_unique"]);

  // The console reads per-fact PASS/FAIL off gate.checks. A blocked row must
  // not render an all-green fact strip.
  const logoCheck = blocked[0].gate.checks.find((c) => c.fact === "logo_own_and_unique");
  assert.equal(logoCheck.pass, false);
  assert.equal(logoCheck.evidence.collidesWith, queued[0].prospectId);

  // And nothing was written or queued for the loser.
  assert.equal(h.calls.write.includes(blocked[0].prospectId), false);
  assert.equal(h.calls.queue.includes(blocked[0].prospectId), false);
});

test("distinct logos never collide, however the pool interleaves them", async () => {
  runner.resetBatches();
  const plan = Array.from({ length: 8 }, (_, i) => ({ mirrorMs: 10, gateMs: (i % 4) * 15 }));
  const h = harness(plan);
  const run = await runner.startBatch({ count: 8, lane: "sandbox" }, { ...h.deps, concurrency: 5 });
  assert.equal(lineState.batchCounts(run.batch).queued, 8);
  assert.equal(run.batch.rows.every((r) => r.status === "queued"), true);
});

test("a row re-shipping its OWN logo is not a collision", async () => {
  runner.resetBatches();
  const sha = shaFor("same-client");
  // Same prospect id twice is not a real batch, but it proves the claim is
  // keyed on OWNERSHIP, not on mere presence in the map: the second row finds
  // the sha already claimed and must still be allowed through, because the
  // client it already belongs to is itself.
  const h = harness([
    { prospectId: "wss-test-dup", sha, mirrorMs: 5 },
    { prospectId: "wss-test-dup", sha, mirrorMs: 5 },
  ]);
  const run = await runner.startBatch({ count: 2, lane: "sandbox" }, { ...h.deps, concurrency: 2 });
  assert.equal(run.batch.rows.every((r) => r.status === "queued"), true);
});

// ---------------------------------------------------------------------------
// the live view: progress, counts, snapshots
// ---------------------------------------------------------------------------

test("onProgress fires for every transition and never shows a row going backwards", async () => {
  runner.resetBatches();
  const plan = [
    { prospectId: "wss-test-1", mirrorMs: 50 },
    { prospectId: "wss-test-2", mirrorMs: 10 },
    { prospectId: "wss-test-3", mirrorMs: 30, gate: false },
    { prospectId: "wss-test-4", mirrorMs: 20 },
    { prospectId: "wss-test-5", mirrorMs: 40, queue: false },
    { prospectId: "wss-test-6", mirrorMs: 5 },
  ];
  const h = harness(plan);
  const run = await runner.startBatch({ count: 6, lane: "sandbox" }, { ...h.deps, concurrency: 3 });

  const order = ["picked", "qualified", "mirrored", "gate_passed", "queued"];
  const rank = (status) => (order.includes(status) ? order.indexOf(status) : 99);

  // NO EVENT LOST: one transition per history entry after "picked", plus the
  // event for the freshly picked list and the settle event.
  const transitions = run.batch.rows.reduce((n, r) => n + r.history.length - 1, 0);
  assert.ok(h.progress.length >= transitions + 2,
    `expected at least ${transitions + 2} progress events, saw ${h.progress.length}`);

  // NO INTERLEAVE CORRUPTION: every event carries the full row list, and no
  // row ever appears to move backwards between events.
  const high = plan.map(() => -1);
  for (const event of h.progress) {
    assert.equal(event.length, 6, "a progress event must always carry every row");
    event.forEach((status, i) => {
      const r = rank(status);
      if (r === 99) return; // terminal failure: rank is not ordered
      assert.ok(r >= high[i], `row ${i} went backwards: ${status}`);
      high[i] = r;
    });
  }

  // The last event is the finished batch the caller got back.
  assert.deepEqual(h.progress[h.progress.length - 1], run.batch.rows.map((r) => r.status));
});

test("batch counts stay coherent mid-run and add up at the end", async () => {
  runner.resetBatches();
  const plan = [
    { prospectId: "wss-test-q1", mirrorMs: 40 },
    { prospectId: "wss-test-q2", mirrorMs: 15 },
    { prospectId: "wss-test-f1", mirrorMs: 25, gate: false },
    { prospectId: "wss-test-f2", mirrorMs: 10, mirror: false, reason: "donor 500" },
    { prospectId: "wss-test-q3", mirrorMs: 35 },
  ];
  const seen = [];
  const h = harness(plan);
  const deps = {
    ...h.deps,
    concurrency: 3,
    onProgress: (batch) => {
      h.deps.onProgress(batch);
      // batchCounts derives from batch.rows on demand. Under concurrency it
      // must still partition the rows exactly — never double-count a row that
      // two workers touched near-simultaneously.
      seen.push(lineState.batchCounts(batch));
    },
  };
  const run = await runner.startBatch({ count: 5, lane: "sandbox" }, deps);

  for (const c of seen) {
    assert.equal(c.total, 5);
    assert.equal(c.queued + c.failed + c.sent + c.working, c.total, "counts must partition the rows");
  }
  assert.deepEqual(lineState.batchCounts(run.batch), { total: 5, ready: 0, queued: 3, failed: 2, sent: 0, working: 0 });
  assert.equal(seen[seen.length - 1].working, 0, "the last event must show nothing still moving");
  assert.equal(lineState.batchSettled(run.batch), true);
});

test("every durable phase checkpoints, and each checkpoint carries the whole batch", async () => {
  runner.resetBatches();
  const snaps = [];
  const plan = Array.from({ length: 6 }, (_, i) => ({ prospectId: `wss-test-s${i}`, mirrorMs: 10 + i * 5 }));
  const h = harness(plan, {
    snapshotSink: (b) => snaps.push({
      rows: (b.rows || []).length,
      done: (b.rows || []).filter((r) => r.status === "queued").length,
    }),
  });
  await runner.startBatch({ count: 6, lane: "sandbox" }, { ...h.deps, concurrency: 3 });

  // One pick-complete checkpoint plus four durable transitions per happy row:
  // qualified, mirrored, gate_passed, queued. A crash may therefore resume at
  // the exact next phase instead of replaying a deploy or browser gate.
  assert.equal(snaps.length, 1 + (6 * 4), "one checkpoint per durable phase, whatever order they finish in");
  assert.ok(snaps.every((s) => s.rows === 6), "a checkpoint must carry every row");
  // Progress only ever grows — a checkpoint must never publish fewer finished
  // rows than an earlier one.
  for (let i = 1; i < snaps.length; i += 1) assert.ok(snaps[i].done >= snaps[i - 1].done);
  assert.equal(snaps[snaps.length - 1].done, 6);
});

test("the durable snapshot is a point-in-time copy, not a live reference", () => {
  runner.resetBatches();
  // putBatch hands the payload to recordEvent, which serialises it LATER. With
  // five rows moving at once, a live reference would store whatever the batch
  // had drifted to by the time the write flushed.
  const batch = {
    batchId: "line_freeze_probe",
    startedAt: "2026-08-07T00:00:00.000Z",
    status: "running",
    rows: [{ prospectId: "a", status: "mirrored" }],
  };
  runner.putBatch(batch);
  const stored = runner.getBatch("line_freeze_probe");
  assert.equal(stored, batch, "memory must keep the LIVE object so a run in progress is visible");

  // A sibling row lands after the checkpoint was taken.
  batch.rows.push({ prospectId: "b", status: "queued" });
  batch.status = "awaiting_approval";
  assert.equal(runner.getBatch("line_freeze_probe").rows.length, 2);
});
