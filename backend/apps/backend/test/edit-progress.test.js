"use strict";

// test/edit-progress.test.js — THE METER CANNOT LIE.
//
// The failure this feature replaces: Riley said "about a minute" over jobs
// measured taking twelve, because nothing recorded where a running edit
// actually was and any number would have been an invention. These tests pin
// the two halves of the fix:
//
//   WRITE — the tracker stamps real transitions onto the job row without ever
//   clobbering the runner's retry budget (result.attempts) and without being
//   able to fail the edit it rides on.
//
//   READ — the percent is derived ONLY from measured history: no completed
//   runs, no number (a stage name is honest; an invented percent is not); and
//   within one attempt the reported percent can never move backwards, no
//   matter how the polls land.

const test = require("node:test");
const assert = require("node:assert/strict");

const EP = require("../lib/edit-progress");

const SLUG = "wss-test-obrien-and-sons-roofing";
const INSTRUCTION = "Make the header phone number bigger.";

function fakeStore(row) {
  const writes = [];
  return {
    writes,
    select: async () => ({ ok: true, mode: "live_select", data: row ? [row] : [] }),
    upsertRow: async (table, r) => { writes.push({ table, row: r }); return { mode: "live_upsert" }; },
  };
}

function jobRow(over = {}) {
  return {
    job_id: "edit_meter_1",
    site_slug: SLUG,
    instruction: INSTRUCTION,
    status: "running",
    result: { attempts: 2 },
    created_at: "2026-08-11T10:00:00.000Z",
    updated_at: "2026-08-11T10:00:05.000Z",
    ...over,
  };
}

/** A completed row whose trail took exactly the given per-stage seconds. */
function doneRow(id, secs = {}) {
  const order = ["reading_site", "planning", "applying", "uploading", "deploying", "verifying"];
  const durations = { reading_site: 2, planning: 20, applying: 1, uploading: 8, deploying: 25, verifying: 30, ...secs };
  let t = Date.parse("2026-08-11T09:00:00.000Z");
  const stages = [];
  for (const stage of order) {
    stages.push({ stage, at: new Date(t).toISOString() });
    t += durations[stage] * 1000;
  }
  stages.push({ stage: "live", at: new Date(t).toISOString() });
  return {
    job_id: id,
    site_slug: SLUG,
    instruction: INSTRUCTION,
    status: "done",
    result: { attempts: 1, say: "done", progress: { lane: "plan", attempt: 1, stages } },
    created_at: "2026-08-11T09:00:00.000Z",
    updated_at: new Date(t).toISOString(),
  };
}

test.beforeEach(() => EP.resetSharesCache());

// ---------------------------------------------------------------------------
// WRITE SIDE — the tracker
// ---------------------------------------------------------------------------

test("tracker: stamps persist onto the row MERGED with the runner's attempts", async () => {
  const store = fakeStore(jobRow());
  const clock = { t: Date.parse("2026-08-11T10:00:05.000Z") };
  const track = EP.createStageTracker({
    jobId: "edit_meter_1",
    siteSlug: SLUG,
    instruction: INSTRUCTION,
    deps: { ...store, now: () => new Date((clock.t += 1000)) },
  });
  await track.stamp("reading_site");
  await track.stamp("planning");

  assert.equal(store.writes.length, 2, "each transition lands one write");
  const last = store.writes[1].row;
  assert.equal(last.job_id, "edit_meter_1");
  assert.equal(last.site_slug, SLUG);
  // THE RETRY BUDGET SURVIVES. Clobbering result.attempts would un-cap the
  // runner's give-up logic — the exact infinite-retry hole the sweeper closed.
  assert.equal(last.result.attempts, 2);
  assert.equal(last.result.progress.attempt, 2);
  assert.deepEqual(last.result.progress.stages.map((s) => s.stage), ["reading_site", "planning"]);
  assert.ok(last.updated_at, "stamps bump updated_at so a live worker never reads as stale");
});

test("tracker: no job row means a local trail and NO table writes", async () => {
  const store = fakeStore(null);
  const track = EP.createStageTracker({ jobId: "edit_ghost", siteSlug: SLUG, instruction: INSTRUCTION, deps: store });
  await track.stamp("reading_site");
  await track.stamp("planning");
  assert.equal(store.writes.length, 0);
  assert.deepEqual(track.summary().stages.map((s) => s.stage), ["reading_site", "planning"]);
});

test("tracker: a broken store cannot fail the edit", async () => {
  const track = EP.createStageTracker({
    jobId: "edit_meter_1",
    siteSlug: SLUG,
    instruction: INSTRUCTION,
    deps: {
      select: async () => { throw new Error("supabase is down"); },
      upsertRow: async () => { throw new Error("also down"); },
    },
  });
  await assert.doesNotReject(() => track.stamp("reading_site"));
  assert.equal(track.summary().stages.length, 1, "the trail still rides the return value");
});

test("tracker: duplicate stamps are idempotent", async () => {
  const store = fakeStore(jobRow());
  const track = EP.createStageTracker({ jobId: "edit_meter_1", siteSlug: SLUG, instruction: INSTRUCTION, deps: store });
  await track.stamp("deploying");
  await track.stamp("deploying");
  assert.equal(track.summary().stages.length, 1);
});

// ---------------------------------------------------------------------------
// MEASUREMENT — shares only exist once history does
// ---------------------------------------------------------------------------

test("shares: thinner than MIN_HISTORY means NO percent, not a guessed one", async () => {
  const select = async () => ({ ok: true, data: [doneRow("a"), doneRow("b")] }); // 2 < 3
  const shares = await EP.loadStageShares({ select, lane: "plan" });
  assert.equal(shares, null);
});

test("shares: p50 stage durations from completed trails, in lane order", async () => {
  const select = async () => ({ ok: true, data: [doneRow("a"), doneRow("b"), doneRow("c", { deploying: 35 })] });
  const shares = await EP.loadStageShares({ select, lane: "plan" });
  assert.ok(shares);
  assert.equal(shares.samples, 3);
  const deploying = shares.stages.find((s) => s.stage === "deploying");
  assert.equal(deploying.durMs, 25_000, "median of 25/25/35 is 25");
  assert.equal(shares.totalMs, shares.stages.reduce((sum, s) => sum + s.durMs, 0));
  // Boundaries are cumulative and ordered.
  const fracs = shares.stages.map((s) => s.startFrac);
  assert.deepEqual(fracs.slice().sort((a, b) => a - b), fracs);
});

test("shares: rows with partial or foreign trails are excluded from the measurement", async () => {
  const partial = doneRow("p");
  partial.result.progress.stages = partial.result.progress.stages.slice(2); // no reading/planning
  const foreign = doneRow("f");
  foreign.result.progress.lane = "undo";
  const select = async () => ({ ok: true, data: [partial, foreign, doneRow("a"), doneRow("b"), doneRow("c")] });
  const shares = await EP.loadStageShares({ select, lane: "plan" });
  assert.equal(shares.samples, 3, "only the three complete plan-lane trails count");
});

// ---------------------------------------------------------------------------
// READ SIDE — the meter
// ---------------------------------------------------------------------------

test("meter: running with NO history names the stage and shows no number", () => {
  const row = jobRow({
    result: { attempts: 1, progress: { lane: "plan", attempt: 1, stages: [{ stage: "deploying", at: "2026-08-11T10:00:10.000Z" }] } },
  });
  const meter = EP.meterFromRow(row, null, { now: Date.parse("2026-08-11T10:00:20.000Z") });
  assert.equal(meter.stage, "deploying");
  assert.equal(meter.percent, null);
  assert.equal(meter.expectedRemainingMs, null);
  assert.match(meter.plainWords, /publishing to your live site/);
  assert.doesNotMatch(meter.plainWords, /\d+ percent/, "no invented percent, ever");
});

test("meter: percent is the measured share of completed stages, moving within a stage by real clock", async () => {
  const select = async () => ({ ok: true, data: [doneRow("a"), doneRow("b"), doneRow("c")] });
  const shares = await EP.loadStageShares({ select, lane: "plan" });
  // total 86s: reading 2, planning 20, applying 1, uploading 8, deploying 25, verifying 30
  const enteredDeploying = Date.parse("2026-08-11T10:01:00.000Z");
  const row = jobRow({
    result: {
      attempts: 1,
      progress: {
        lane: "plan",
        attempt: 1,
        stages: [
          { stage: "reading_site", at: "2026-08-11T10:00:00.000Z" },
          { stage: "planning", at: "2026-08-11T10:00:02.000Z" },
          { stage: "applying", at: "2026-08-11T10:00:22.000Z" },
          { stage: "uploading", at: "2026-08-11T10:00:23.000Z" },
          { stage: "deploying", at: new Date(enteredDeploying).toISOString() },
        ],
      },
    },
  });

  // At the instant deploying began: 31/86 of the measured road is behind it.
  const atEntry = EP.meterFromRow(row, shares, { now: enteredDeploying });
  assert.equal(atEntry.percent, Math.round((31 / 86) * 100)); // 36
  assert.match(atEntry.plainWords, /about 36 percent through/);
  assert.match(atEntry.plainWords, /to go/, "a measured remainder is spoken");

  // Ten measured seconds later the bar has crept exactly ten seconds forward.
  const midway = EP.meterFromRow(row, shares, { now: enteredDeploying + 10_000 });
  assert.equal(midway.percent, Math.round((41 / 86) * 100)); // 48
  assert.ok(midway.expectedRemainingMs < atEntry.expectedRemainingMs);

  // A stage that runs PAST its p50 pins at the next boundary — the meter may
  // wait there but may never claim a transition that was not stamped.
  const overrun = EP.meterFromRow(row, shares, { now: enteredDeploying + 120_000 });
  assert.equal(overrun.percent, Math.round((56 / 86) * 100)); // 65 — verifying's boundary
  assert.ok(overrun.percent < 100);
});

test("meter: the percent NEVER moves backwards within an attempt", async () => {
  const select = async () => ({ ok: true, data: [doneRow("a"), doneRow("b"), doneRow("c")] });
  const shares = await EP.loadStageShares({ select, lane: "plan" });
  const entered = Date.parse("2026-08-11T10:01:00.000Z");
  const row = jobRow({
    result: { attempts: 1, progress: { lane: "plan", attempt: 1, stages: [
      { stage: "reading_site", at: "2026-08-11T10:00:00.000Z" },
      { stage: "planning", at: "2026-08-11T10:00:02.000Z" },
      { stage: "applying", at: "2026-08-11T10:00:22.000Z" },
      { stage: "uploading", at: "2026-08-11T10:00:23.000Z" },
      { stage: "deploying", at: new Date(entered).toISOString() },
    ] } },
  });
  let last = -1;
  // Polls land out of order, the cache refreshes, whatever — the reported
  // number must be non-decreasing because a bar that retreats is a lie about
  // work UNhappening.
  for (const offset of [0, 5_000, 3_000, 12_000, 9_000, 40_000, 20_000]) {
    const m = EP.meterFromRow(row, shares, { now: entered + offset });
    assert.ok(m.percent >= last, `${m.percent} must be >= ${last}`);
    last = m.percent;
  }
});

test("meter: stamps gone quiet past the stall line end the time promise, not the truth", async () => {
  const select = async () => ({ ok: true, data: [doneRow("a"), doneRow("b"), doneRow("c")] });
  const shares = await EP.loadStageShares({ select, lane: "plan" });
  const entered = Date.parse("2026-08-11T10:01:00.000Z");
  const row = jobRow({
    result: { attempts: 1, progress: { lane: "plan", attempt: 1, stages: [
      { stage: "reading_site", at: "2026-08-11T10:00:00.000Z" },
      { stage: "planning", at: "2026-08-11T10:00:02.000Z" },
      { stage: "applying", at: "2026-08-11T10:00:22.000Z" },
      { stage: "uploading", at: "2026-08-11T10:00:23.000Z" },
      { stage: "deploying", at: new Date(entered).toISOString() },
    ] } },
  });

  // Two minutes past the stamp is still an overrun, not a stall: stage words
  // and a measured remainder are the honest sentence.
  const fresh = EP.meterFromRow(row, shares, { now: entered + 120_000 });
  assert.match(fresh.plainWords, /publishing to your live site/);
  assert.equal(typeof fresh.expectedRemainingMs, "number");

  // Past three minutes of silence nothing alive is stamping. Measured live
  // 2026-08-12 (job edit_1786498846712, frozen in deploying): the meter said
  // "under twenty seconds to go" for eleven minutes. The stage and the
  // recorded percent hold; the TIME PROMISE goes.
  const stalled = EP.meterFromRow(row, shares, { now: entered + EP.STALLED_AFTER_MS + 1_000 });
  assert.equal(stalled.stage, "deploying", "the recorded stage still stands");
  assert.equal(stalled.percent, fresh.percent, "recorded progress is not un-happened");
  assert.equal(stalled.expectedRemainingMs, null, "no remainder quoted over a dead heartbeat");
  // The owner's bar, verbatim: "this is taking longer than it should — I've
  // flagged it" instead of freezing at a number.
  assert.match(stalled.plainWords, /taking longer than it should/);
  assert.match(stalled.plainWords, /flagged/);
  assert.doesNotMatch(stalled.plainWords, /seconds to go|minute to go|percent/);
  assert.ok(stalled.stalledMs > EP.STALLED_AFTER_MS);
  assert.equal(stalled.stalled, true, "the page needs the fact, not just the sentence");
});

test("meter: a stalled job is FLAGGED — one ledger event per attempt, then said", async () => {
  EP.resetStallFlags();
  const entered = Date.parse("2026-08-11T10:01:00.000Z");
  const row = jobRow({
    site_slug: "wss-test-flag-me",
    result: { attempts: 1, progress: { lane: "plan", attempt: 1, stages: [
      { stage: "reading_site", at: "2026-08-11T10:00:00.000Z" },
      { stage: "deploying", at: new Date(entered).toISOString() },
    ] } },
  });
  const events = [];
  const recordEvent = async (name, payload) => { events.push({ name, payload }); return { ok: true }; };
  const select = async () => ({ ok: true, data: [] });
  const now = entered + EP.STALLED_AFTER_MS + 5_000;

  const meter = await EP.describeEditProgress(row, { select, recordEvent, now });
  assert.equal(meter.stalled, true);
  // The write is fire-and-forget; give the microtask queue one turn.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1, "the flag lands on the ledger");
  assert.equal(events[0].name, "ghost_agency_site_edit_stalled");
  assert.equal(events[0].payload.jobId, row.job_id);
  assert.equal(events[0].payload.siteSlug, "wss-test-flag-me");

  // Polled again five seconds later — the dashboard polls every few seconds —
  // the flag is NOT re-recorded. One stall, one ledger row.
  await EP.describeEditProgress(row, { select, recordEvent, now: now + 5_000 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1, "a poll is not a second stall");
  EP.resetStallFlags();
});

test("meter: a queued row waiting past the stall line stops saying 'in a moment'", () => {
  const row = jobRow({ status: "queued", result: null, created_at: "2026-08-11T10:00:00.000Z" });
  const fresh = EP.meterFromRow(row, null, { now: Date.parse("2026-08-11T10:00:30.000Z") });
  assert.match(fresh.plainWords, /in line to start/);
  const stalled = EP.meterFromRow(row, null, { now: Date.parse("2026-08-11T10:03:01.000Z") });
  assert.equal(stalled.percent, 0);
  assert.equal(stalled.expectedRemainingMs, null);
  assert.match(stalled.plainWords, /taking longer than it should to get started/);
  assert.match(stalled.plainWords, /flagged/);
  assert.equal(stalled.stalled, true);
});

test("meter: terminal rows answer plainly — done is 100, stopped is unnumbered", () => {
  const done = EP.meterFromRow(jobRow({ status: "done", result: { say: "That's live." } }), null, {});
  assert.equal(done.percent, 100);
  assert.equal(done.stage, "live");
  assert.equal(done.plainWords, "That's live.");

  const failed = EP.meterFromRow(jobRow({ status: "failed", result: { say: "It stopped partway." } }), null, {});
  assert.equal(failed.percent, null);
  assert.equal(failed.plainWords, "It stopped partway.");

  const queued = EP.meterFromRow(jobRow({ status: "queued", result: null }), null, {});
  assert.equal(queued.percent, 0, "nothing started is a measured zero, not a guess");
});

test("meter: a terminal row is described without touching the store", async () => {
  const select = async () => { throw new Error("must not be called"); };
  const meter = await EP.describeEditProgress(jobRow({ status: "done", result: { say: "ok" } }), { select });
  assert.equal(meter.percent, 100);
});

test("meter: running rows read history through the same select the panel already holds", async () => {
  let calls = 0;
  const select = async () => { calls += 1; return { ok: true, data: [doneRow("a"), doneRow("b"), doneRow("c")] }; };
  const row = jobRow({ result: { attempts: 1, progress: { lane: "plan", attempt: 1, stages: [{ stage: "planning", at: new Date().toISOString() }] } } });
  const meter = await EP.describeEditProgress(row, { select });
  assert.ok(calls >= 1);
  assert.equal(typeof meter.percent, "number");
  assert.equal(meter.stage, "planning");
});

// ---------------------------------------------------------------------------
// THE SPOKEN REMAINDER — rounded, friendly, and only from measured ms
// ---------------------------------------------------------------------------

test("remainingWords speaks in tens of seconds and whole minutes", () => {
  assert.equal(EP.remainingWords(9_000), "under twenty seconds to go");
  assert.equal(EP.remainingWords(22_000), "about twenty seconds to go");
  assert.equal(EP.remainingWords(31_000), "about thirty seconds to go");
  assert.equal(EP.remainingWords(70_000), "about a minute to go");
  assert.equal(EP.remainingWords(4 * 60_000), "about 4 minutes to go");
  assert.equal(EP.remainingWords(NaN), "");
});

// ---------------------------------------------------------------------------
// THE PANEL — the dashboard ships the identical meter
// ---------------------------------------------------------------------------

test("listCustomerEdits attaches the meter to every row without breaking the transcript", async () => {
  const { listCustomerEdits } = require("../lib/customer-edits");
  const open = jobRow({ status: "running", result: { attempts: 1, progress: { lane: "plan", attempt: 1, stages: [{ stage: "uploading", at: new Date().toISOString() }] } } });
  const settled = jobRow({ job_id: "edit_meter_2", status: "done", result: { say: "Done." } });
  const select = async (table, query) => {
    // The panel's row read and the meter's history read share one function.
    if (String(query).includes("status=eq.done")) return { ok: true, data: [doneRow("a"), doneRow("b"), doneRow("c")] };
    return { ok: true, mode: "live_select", data: [open, settled] };
  };
  const { ok, edits } = await listCustomerEdits({ siteSlug: SLUG, select });
  assert.equal(ok, true);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].meter.stage, "uploading");
  assert.equal(typeof edits[0].meter.percent, "number");
  assert.match(edits[0].meter.plainWords, /saving the new version/);
  assert.equal(edits[1].meter.percent, 100);
});
