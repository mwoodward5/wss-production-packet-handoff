"use strict";

// EVERY EDIT JOB REACHES AN ENDING.
//
// Measured in production on 2026-08-08, before any of this existed:
//   edit_1784934678499_cxf6ba  queued  manual-dq-build-sgi-energy      15 DAYS
//   edit_1786112904788_3bngct  running wss-test-logic-heating-...      33 HOURS
//   edit_1786112920658_s9w48w  running wss-test-logic-heating-...      33 HOURS
// Every one of them was showing a paying customer "Working…" on a job with no
// worker behind it, and the chat panel's own poll gave up after three minutes
// and left the spinner turning.
//
// WHAT FAILED BEFORE THIS CHANGE, test by test:
//   - the hang test HUNG. executeEditJob awaited runSiteChange bare, so work
//     that never settles meant a function that never returned and a row that
//     never got a terminal write. That is the 33-hour row, exactly.
//   - the unroutable test found NO WRITE AT ALL: the old runner returned
//     {status:400} and left the row "queued" for ever, re-selected first on
//     every drain because the queue is ordered created_at.asc. That is the
//     15-day row, exactly.
//   - there was no sweeper, no attempt budget, and no opportunistic trigger:
//     the only thing that could ever have closed these rows was
//     api/cron/run-edit-jobs.js, and the Vercel project's cron switch has been
//     off since 2026-07-29T23:31:39Z — that route has never once run.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runner = require("../lib/edit-job-runner");
const sweeper = require("../lib/edit-job-sweeper");
const { describeEditJob, FALLBACK, STALE_RUNNING_MS } = require("../lib/customer-edits");

const SLUG = "wss-test-logic-heating-and-air-tulsa";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function jobRow(over = {}) {
  const at = new Date(Date.now() - MINUTE).toISOString();
  return {
    job_id: "edit_test_1",
    site_slug: SLUG,
    instruction: "Make the phone number in the header bigger.",
    status: "queued",
    result: null,
    created_at: at,
    updated_at: at,
    ...over,
  };
}

/** A runner wired to fakes, capturing every row it writes. */
function harness({ row = jobRow(), runSiteChange, resolveSiteEditTarget, ...rest } = {}) {
  const writes = [];
  const events = [];
  const notices = [];
  return {
    writes,
    events,
    notices,
    deps: {
      select: async () => ({ ok: true, data: [row] }),
      upsertRow: async (table, written) => { writes.push(written); return { mode: "live_write" }; },
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
      resolveSiteEditTarget: resolveSiteEditTarget || (async () => ({ projectName: SLUG, aliasHost: `${SLUG}.wss-ai.com` })),
      runSiteChange: runSiteChange || (async () => ({ applied: true, changedFiles: ["index.html"] })),
      notifyOwner: async (n) => { notices.push(n); },
      ...rest,
    },
  };
}

const lastWrite = (writes) => writes[writes.length - 1];

// ---------------------------------------------------------------------------
// 1. A job always reaches a terminal state
// ---------------------------------------------------------------------------

test("a job whose work never finishes still lands on a terminal state", { timeout: 15000 }, async () => {
  // THE 33-HOUR ROW. Before this change runSiteChange was awaited with no
  // ceiling, so this exact input made executeEditJob never return.
  const h = harness({ runSiteChange: () => new Promise(() => {}) });
  const out = await runner.executeEditJob("edit_test_1", { ...h.deps, editDeadlineMs: 60 });

  assert.equal(out.status, "failed", "a hang must end as a failure, not as silence");
  assert.equal(out.timedOut, true);
  const written = lastWrite(h.writes);
  assert.equal(written.status, "failed", "the ROW is what the customer reads; it must be terminal");
  assert.equal(written.result.timed_out, true);
  assert.match(written.result.error, /did not finish within/);
  assert.ok(h.events.some((e) => e.name === "ghost_agency_site_edit_failed"), "the ending is on the record");
});

test("a timed-out job never claims the site is unchanged, because nobody knows that", async () => {
  const h = harness({ runSiteChange: () => new Promise(() => {}) });
  await runner.executeEditJob("edit_test_1", { ...h.deps, editDeadlineMs: 60 });
  const said = describeEditJob({ ...jobRow(), status: "failed", result: lastWrite(h.writes).result }).say;

  // FALLBACK.failed asserts "Nothing on your site changed" — true of a plan
  // that threw before deploying, a LIE about work cut off mid-flight.
  assert.notEqual(said, FALLBACK.failed);
  assert.doesNotMatch(said, /[Nn]othing on your site changed/);
  assert.match(said, /can't confirm/i, "the honest sentence names the uncertainty");
});

test("the ceiling is raced, not merely requested of the callee", async () => {
  // report-grade.js paid for this lesson today: an AbortSignal is a REQUEST to
  // the transport, and a transport that ignores it leaves the await pending.
  // withDeadline must resolve against work that honours nothing at all.
  const started = Date.now();
  await assert.rejects(
    () => runner.withDeadline(() => new Promise(() => {}), 40, "the work"),
    (err) => err.code === "edit_deadline_exceeded",
  );
  assert.ok(Date.now() - started < 5000, "the ceiling belongs to us, not to the callee");
});

test("a target lookup that hangs is bounded too, and ends the job", { timeout: 15000 }, async () => {
  // resolveSiteEditTarget can reach listAll + download + a promotion deploy.
  const h = harness({ resolveSiteEditTarget: () => new Promise(() => {}) });
  const out = await runner.executeEditJob("edit_test_1", { ...h.deps, targetDeadlineMs: 60 });
  assert.equal(out.status, "failed");
  assert.equal(lastWrite(h.writes).status, "failed");
});

test("an unroutable job is CLOSED, not silently returned", async () => {
  // THE 15-DAY ROW. manual-dq-build-sgi-energy resolves to null and the old
  // runner returned {status:400} having written nothing at all — so it stayed
  // queued for ever AND, because the drain orders created_at.asc, was picked
  // first on every single pass.
  const h = harness({ resolveSiteEditTarget: async () => null });
  const out = await runner.executeEditJob("edit_test_1", h.deps);

  assert.equal(out.status, "failed");
  // The claim now precedes target resolution (the atomic-claim fix), so an
  // unroutable job writes its claim and then its ending. What must stay true:
  // exactly one TERMINAL write, and it is the last word on the row.
  assert.equal(h.writes.filter((w) => w.status === "failed").length, 1, "exactly one ending");
  assert.equal(lastWrite(h.writes).status, "failed");
  assert.equal(lastWrite(h.writes).result.unroutable, true);
  assert.match(lastWrite(h.writes).result.error, /unknown or unauthorized site/);
});

test("a job that has burned its attempts gives up out loud and starts no work", async () => {
  let ran = 0;
  const h = harness({
    row: jobRow({ status: "running", result: { attempts: sweeper.MAX_ATTEMPTS } }),
    runSiteChange: async () => { ran += 1; return { applied: true }; },
  });
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(ran, 0, "an exhausted job must not be started again");
  assert.equal(out.status, "failed");
  assert.equal(lastWrite(h.writes).result.error, "attempts_exhausted");
  // Two attempts each died somewhere unknown. "Nothing changed" is not ours to say.
  const said = describeEditJob({ ...jobRow(), status: "failed", result: lastWrite(h.writes).result }).say;
  assert.doesNotMatch(said, /[Nn]othing on your site changed/);
  assert.equal(said, sweeper.ABANDONED_SAY);
});

test("a healthy edit still succeeds, and now carries its attempt count", async () => {
  const h = harness();
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(out.status, "done");
  assert.equal(lastWrite(h.writes).status, "done");
  assert.equal(lastWrite(h.writes).result.attempts, 1);
  assert.equal(h.notices.length, 1, "the owner is still told when a change lands");
  // The claim is written before the notification, so a dead mail provider can
  // never cost the customer their answer.
  assert.equal(h.writes.some((w) => w.status === "running"), true);
});

test("a refusal is still not a failure", async () => {
  const h = harness({ runSiteChange: async () => ({ applied: false, reason: "unbacked_claim", say: "We won't put that on your site." }) });
  const out = await runner.executeEditJob("edit_test_1", h.deps);
  assert.equal(out.status, "refused");
  assert.equal(lastWrite(h.writes).status, "refused");
  assert.equal(h.notices.length, 0, "a refusal is the system working, not an alarm");
  assert.equal(describeEditJob({ ...jobRow(), status: "refused", result: lastWrite(h.writes).result }).say, "We won't put that on your site.");
});

// ---------------------------------------------------------------------------
// 2. The safety net actually runs
// ---------------------------------------------------------------------------

test("the 33-hour and 15-day rows are exactly what the sweeper closes", async () => {
  const now = Date.now();
  const rows = [
    { job_id: "edit_1784934678499_cxf6ba", site_slug: "manual-dq-build-sgi-energy", instruction: "x", status: "queued", created_at: new Date(now - 15 * 24 * HOUR).toISOString(), updated_at: new Date(now - 15 * 24 * HOUR).toISOString() },
    { job_id: "edit_1786112904788_3bngct", site_slug: SLUG, instruction: "x", status: "running", created_at: new Date(now - 33 * HOUR).toISOString(), updated_at: new Date(now - 33 * HOUR).toISOString() },
    { job_id: "edit_fresh", site_slug: SLUG, instruction: "x", status: "running", created_at: new Date(now - 2 * MINUTE).toISOString(), updated_at: new Date(now - 2 * MINUTE).toISOString() },
  ];
  const writes = [];
  const out = await sweeper.sweepDeadEditJobs({
    select: async () => ({ ok: true, data: rows }),
    upsertRow: async (_t, row) => { writes.push(row); return { mode: "live_write" }; },
    recordEvent: async () => ({ ok: true }),
    now,
  });

  assert.equal(out.closed.length, 2);
  assert.deepEqual(out.closed.map((c) => c.reason), ["never_started", "worker_stopped"]);
  assert.equal(writes.every((w) => w.status === "failed"), true);
  // A LIVE job is never touched. Closing one would tell a customer their change
  // failed while it was still being made.
  assert.equal(writes.some((w) => w.job_id === "edit_fresh"), false);

  const neverStarted = describeEditJob({ ...rows[0], status: "failed", result: writes[0].result });
  assert.match(neverStarted.say, /never got started/);
  assert.match(neverStarted.say, /nothing on your site changed/i, "a job that never ran genuinely changed nothing");
  const abandoned = describeEditJob({ ...rows[1], status: "failed", result: writes[1].result });
  assert.doesNotMatch(abandoned.say, /[Nn]othing on your site changed/, "we do not know that, so we must not say it");
  assert.equal(abandoned.open, false, "the customer stops seeing a spinner");
});

test("the sweeper never starts work — it only ever writes endings", async () => {
  // This is why it is safe to hang off a customer's poll. A poll that could
  // deploy to a live website would be a far worse bug than the one it fixes.
  // Asserted structurally: it cannot reach the engine because it does not
  // require it — and that also keeps lib/site-change-plan.js out of the cold
  // start of a read-only list.
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "edit-job-sweeper.js"), "utf8");
  const required = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(required, [], "the sweeper depends on nothing — the store arrives as arguments");
  assert.equal(typeof sweeper.sweepDeadEditJobs, "function");
  assert.equal(sweeper.executeEditJob, undefined);
  assert.equal(sweeper.drainEditQueue, undefined);
});

test("the poll on the dashboard is what actually drains the queue now", async () => {
  // THE CRON IS OFF. api/cron/run-edit-jobs.js was added 2026-08-05; the Vercel
  // project's cron switch was turned off 2026-07-29T23:31:39Z and is still off,
  // so that route has never executed. The safety net has to ride on traffic.
  const editsPath = require.resolve("../api/connect/edits.js");
  const connectPath = require.resolve("../lib/connect");
  const storePath = require.resolve("../lib/store");
  const saved = { edits: require.cache[editsPath], connect: require.cache[connectPath], store: require.cache[storePath] };
  const now = Date.now();
  const dead = { job_id: "edit_dead", site_slug: SLUG, instruction: "x", status: "running", created_at: new Date(now - 33 * HOUR).toISOString(), updated_at: new Date(now - 33 * HOUR).toISOString() };
  const writes = [];

  require.cache[connectPath] = { id: connectPath, filename: connectPath, loaded: true, exports: { resolveConnectScope: () => ({ mode: "tenant", siteSlug: SLUG }) } };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
      select: async () => ({ ok: true, mode: "live_select", data: [dead] }),
      upsertRow: async (_t, row) => { writes.push(row); return { mode: "live_write" }; },
      recordEvent: async () => ({ ok: true }),
    },
  };
  delete require.cache[editsPath];
  try {
    sweeper.resetSweepThrottle();
    const handler = require(editsPath);
    const res = { statusCode: 200, body: "", setHeader() {}, end(c) { if (c) this.body += c; return this; } };
    await handler({ method: "GET", headers: {}, query: {} }, res);
    assert.equal(writes.length, 1, "a customer opening their own panel closes a job nothing else would have");
    assert.equal(writes[0].job_id, "edit_dead");
    assert.equal(writes[0].status, "failed");
    assert.equal(JSON.parse(res.body).ok, true, "and the page still loads");
  } finally {
    sweeper.resetSweepThrottle();
    for (const [p, m] of [[editsPath, saved.edits], [connectPath, saved.connect], [storePath, saved.store]]) {
      if (m) require.cache[p] = m; else delete require.cache[p];
    }
  }
});

test("the ride-along sweep is throttled, so a 4-second poll is not a 4-second scan", async () => {
  sweeper.resetSweepThrottle();
  let scans = 0;
  const deps = {
    select: async () => { scans += 1; return { ok: true, data: [] }; },
    upsertRow: async () => ({ mode: "live_write" }),
  };
  const t = Date.now();
  await sweeper.maybeSweepDeadEditJobs({ ...deps, now: t });
  await sweeper.maybeSweepDeadEditJobs({ ...deps, now: t + 4000 });
  await sweeper.maybeSweepDeadEditJobs({ ...deps, now: t + 8000 });
  assert.equal(scans, 1);
  await sweeper.maybeSweepDeadEditJobs({ ...deps, now: t + sweeper.SWEEP_MIN_INTERVAL_MS + 1 });
  assert.equal(scans, 2);
  sweeper.resetSweepThrottle();
});

test("a failed sweep never takes down the page it was riding on", async () => {
  sweeper.resetSweepThrottle();
  const out = await sweeper.sweepDeadEditJobs({
    select: async () => { throw new Error("supabase is down"); },
    upsertRow: async () => ({ mode: "live_write" }),
  });
  assert.equal(out.ok, false);
  assert.deepEqual(out.closed, []);
  sweeper.resetSweepThrottle();
});

test("the sweep and the drain cannot disagree about a row", () => {
  // They used to share only a comment ("Matches drainEditQueue"). A comment is
  // not a guarantee; now they share the classifier and the constant.
  assert.equal(STALE_RUNNING_MS, sweeper.STALE_RUNNING_MS);
  const now = Date.now();
  const running = (ageMs, attempts) => ({ status: "running", created_at: new Date(now - ageMs).toISOString(), updated_at: new Date(now - ageMs).toISOString(), result: attempts ? { attempts } : null });

  assert.equal(sweeper.classifyStuckJob(running(2 * MINUTE), now).state, "in_flight");
  // Between the stale mark and the abandoned mark the DRAIN owns the row — that
  // gap is what stops the two of them racing for it.
  assert.equal(sweeper.classifyStuckJob(running(12 * MINUTE), now).state, "retryable");
  assert.equal(sweeper.classifyStuckJob(running(12 * MINUTE, 2), now).state, "dead");
  assert.equal(sweeper.classifyStuckJob(running(33 * HOUR), now).state, "dead");
  assert.equal(sweeper.classifyStuckJob({ status: "done" }, now).state, "settled");
  // A row we cannot date is still showing somebody a spinner.
  assert.equal(sweeper.classifyStuckJob({ status: "running", created_at: "", updated_at: "" }, now).state, "dead");
});

test("the cron route sweeps as well as drains, for when the switch goes back on", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "api", "cron", "run-edit-jobs.js"), "utf8");
  assert.match(src, /sweepDeadEditJobs/);
  assert.match(src, /drainEditQueue/);
  // This used to pin the literal date 2026-07-29 out of the file header. A date
  // in a comment is not a contract — the header was rewritten when the fast-ack
  // landed and the test went red over prose while the wiring above was fine.
  // What has to survive a rewrite is that the route still explains itself as the
  // durable path behind the inline kick, so the next reader does not delete it
  // as dead code.
  assert.match(src, /durable safety net|sweeper/i,
    "the reason this route exists is written where the next reader will look");
  // Dead rows are closed BEFORE the drain: a corpse that is still holding a
  // claim would otherwise make the drain skip live work behind it.
  assert.ok(src.indexOf("sweepDeadEditJobs({") < src.indexOf("drainEditQueue({"),
    "the sweep runs before the drain");
});

// ---------------------------------------------------------------------------
// 3. The customer sees the truth
// ---------------------------------------------------------------------------

test("the panel watches past the runner's own ceiling, and says so when it stops", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "labs-site", "dashboard", "index.html"), "utf8");
  const window = Number(/POLL_WINDOW_MS=(\d+)/.exec(html)[1]);

  // THE MISALIGNMENT THAT MADE A HUNG EDIT UNRESOLVABLE ON SCREEN: the panel
  // used to stop at 45 x 4s = 180000ms while the server had no ceiling at all.
  assert.ok(
    window > runner.EDIT_DEADLINE_MS,
    `the poll window (${window}ms) must outlast the runner's ceiling (${runner.EDIT_DEADLINE_MS}ms) or an edit can never be seen to settle`,
  );
  // And when it does stop it stops in WORDS, not by freezing a chip.
  assert.match(html, /pollGaveUp=true/);
  assert.match(html, /we’ve stopped watching it live/);
  assert.doesNotMatch(html, /we will email you|we'll email you/i, "we do not email the customer, so we must not say we will");
});

test("Riley stops predicting a minute she cannot promise", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "edit-status-core.js"), "utf8");
  assert.match(src, /runningLong/);
  // The two 33-hour rows would have been answered "another minute or two" on
  // every single poll for a day and a half. Past the stall line she says the
  // owner's sentence — taking longer than it should, FLAGGED — and the flag
  // is recorded before it is spoken (flagStalledEditJob), so it is a fact.
  assert.match(src, /taking longer than it should/);
  assert.match(src, /flagged/i);
  assert.match(src, /flagStalledEditJob/);
  assert.match(src, /guess at a time/);
});

// ---------------------------------------------------------------------------
// THE CLAIM IS ATOMIC — the 79% double-execution fix
// ---------------------------------------------------------------------------

test("losing the claim race means NOT running the edit", async () => {
  // Second caller: the conditional PATCH matched zero rows because the first
  // caller's claim landed. The loser must not touch the site.
  let ran = 0;
  const h = harness({ runSiteChange: async () => { ran += 1; return { applied: true }; } });
  const out = await runner.executeEditJob("edit_test_1", {
    ...h.deps,
    conditionalUpdate: async () => ({ ok: true, mode: "live_update", updated: false, rows: [] }),
  });
  assert.equal(out.status, "in_flight");
  assert.equal(out.ok, false);
  assert.equal(ran, 0, "the losing caller must not execute the edit");
  assert.equal(h.writes.length, 0, "and must not write anything over the winner's row");
});

test("winning the claim runs exactly one edit, through the conditional guard", async () => {
  let ran = 0;
  const guards = [];
  const h = harness({ runSiteChange: async () => { ran += 1; return { applied: true, changedFiles: ["index.html"] }; } });
  const out = await runner.executeEditJob("edit_test_1", {
    ...h.deps,
    conditionalUpdate: async (table, idColumn, idValue, guard, patch) => {
      guards.push({ table, idColumn, idValue, guard, patch });
      return { ok: true, mode: "live_update", updated: true, rows: [{ job_id: idValue }] };
    },
  });
  assert.equal(out.status, "done");
  assert.equal(ran, 1);
  // The per-site lease rides the same conditional mechanism (claim, then
  // acquire, then release) — but the JOB claim is and stays the FIRST call.
  assert.equal(guards.length, 3);
  assert.equal(guards[0].table, "ghost_agency_edit_jobs");
  assert.equal(guards[0].patch.status, "running");
  // The guard must refuse fresh running rows and done rows, and admit stale ones.
  assert.match(guards[0].guard.or, /status\.neq\.running/);
  assert.match(guards[0].guard.or, /status\.neq\.done/);
  assert.match(guards[0].guard.or, /status\.eq\.running,updated_at\.lt\./);
  // The lease traffic is distinguishable from the claim: a lock-status patch on
  // the site's lease row, never on the job's.
  assert.equal(guards[1].patch.status, "lock");
  assert.match(guards[1].idValue, /^site_lock:/);
  assert.equal(guards[2].patch.status, "lock");
  assert.match(guards[2].guard["result->>lock"], /^eq\./, "only the holder's token can release the lease");
});

test("an empty representation does NOT cost the winner the job — the token settles it", async () => {
  // Measured live 2026-08-12 (patch-probe): the conditional PATCH applied and
  // returned `[]`, because PostgREST re-applies the or= guard to the RETURNING
  // set and the claim transition falsifies its own guard. The runner must read
  // the row back and recognise its own claim token.
  let ran = 0;
  let capturedToken = null;
  const row = jobRow();
  const h = harness({
    row,
    runSiteChange: async () => { ran += 1; return { applied: true, changedFiles: ["index.html"], verified: { ok: true } }; },
  });
  const out = await runner.executeEditJob("edit_test_1", {
    ...h.deps,
    // The row the verify read sees carries the token the PATCH wrote. The JOB
    // claim is the ambiguous one; the site lease goes through the same store
    // and the fake lets it win cleanly.
    select: async () => ({ ok: true, data: [{ ...row, status: "running", result: { attempts: 1, claim: capturedToken } }] }),
    conditionalUpdate: async (_t, _c, idValue, _g, patch) => {
      if (idValue === "edit_test_1") {
        capturedToken = patch.result.claim;
        return { ok: true, mode: "live_update", updated: false, rows: [] }; // applied, hidden
      }
      return { ok: true, mode: "live_update", updated: true, rows: [] };
    },
  });
  assert.equal(out.status, "done", "the winner must run the job it won");
  assert.equal(ran, 1);
});

test("a claim the store cannot take leaves the job queued for the next pass", async () => {
  let ran = 0;
  const h = harness({ runSiteChange: async () => { ran += 1; return { applied: true }; } });
  const out = await runner.executeEditJob("edit_test_1", {
    ...h.deps,
    conditionalUpdate: async () => ({ ok: false, mode: "live_update_failed", updated: false }),
  });
  assert.equal(out.status, "claim_unavailable");
  assert.equal(ran, 0);
  assert.equal(h.writes.length, 0, "no write without a claim");
});

test("a failed row with its own sentence shows that sentence, not the generic one", () => {
  const withSay = describeEditJob({ job_id: "j", status: "failed", instruction: "x", result: { say: "We stopped it partway and can't confirm what landed." } });
  assert.equal(withSay.say, "We stopped it partway and can't confirm what landed.");
  // A plain failure — one that threw before deploying — still gets the
  // guarantee runSiteChange actually makes.
  const plain = describeEditJob({ job_id: "j", status: "failed", instruction: "x", result: { error: "planner_unavailable" } });
  assert.equal(plain.say, FALLBACK.failed);
});
