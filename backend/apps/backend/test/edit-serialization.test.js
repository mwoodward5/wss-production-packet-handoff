"use strict";
// test/edit-serialization.test.js — RAPID EDITS ACCUMULATE; THEY DO NOT CLOBBER.
//
// THE MEASURED PRODUCTION FAILURE THIS FILE HOLDS THE LINE AGAINST. Air
// Creation, 2026-08-10→11 (call forensics): four edit jobs fired ~68s apart —
// jobId epochs prove the order. Edit 1 (logo ×2) and edit 2 (taller box) were
// verifiably LIVE and seen by the caller. Then BOTH vanished between 22:39:11
// and 22:40:44, coinciding with edit 3's late-landing deploy, while edit 3's
// own change (hero text) never appeared. Caller, verbatim: "the hero verbiage
// has not been changed... And the logo appears to be back to the original
// size."
//
// WHY IT HAPPENED. Each job reads the site's WHOLE archive and publishes the
// WHOLE site from what it read. 68s of spacing against an apply+deploy window
// north of 60s meant every job read the site BEFORE the previous job's write
// landed: last-write-wins at full-site granularity, so rapid successive edits
// could not accumulate. The per-job atomic claim (edit-job-terminal-state)
// stops two workers on the SAME job; it never guarded two jobs on the same
// SITE.
//
// THE THREE LINES TESTED HERE:
//   1. PER-SITE LEASE — job N+1 cannot begin its archive read until job N's
//      deploy + verification + terminal write are done (read-after-write),
//      serverless-safe: the lease is one conditional PATCH, decided by the
//      store, with a one-shot token and a stale-lease TTL.
//   2. STALE-BASE GUARD — even if a lease is lost, the engine re-reads the
//      site's write marker immediately before uploading and REFUSES to
//      publish from a base another writer has moved (named reason
//      `stale_site_base`), pre-upload, so nothing clobbered can ship.
//   3. SERIAL SAME-SITE DRAIN — a terminal job pulls its site's next queued
//      job into the SAME pass, so consecutive edits accumulate on a fresh
//      base in seconds instead of waiting for the next cron tick. Different
//      sites stay independent.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const runner = require("../lib/edit-job-runner");
const sweeper = require("../lib/edit-job-sweeper");
const plan = require("../lib/site-change-plan");

const MINUTE = 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// A FAKE STORE with the exact semantics the runner leans on: a conditional
// PATCH evaluated per-row (PostgREST), an INSERT that cannot overwrite, an
// upsert keyed on job_id, and the three select shapes the runner issues.
// ---------------------------------------------------------------------------

/** Evaluate one PostgREST term: `col.op.value` / `result->>lock.is.null`. */
function evalTerm(row, term) {
  const dotAt = term.indexOf(".is.null");
  if (dotAt !== -1) {
    const col = term.slice(0, dotAt);
    const value = col === "result->>lock" ? (row.result ? row.result.lock ?? null : null) : row[col] ?? null;
    return value === null;
  }
  const m = /^(.+?)\.(eq|neq|lt)\.(.*)$/.exec(term);
  assert.ok(m, `fake store: unsupported term ${term}`);
  const [, col, op, raw] = m;
  const value = col === "result->>lock" ? (row.result ? row.result.lock ?? null : null) : row[col];
  if (op === "eq") return value === raw;
  if (op === "neq") return value !== raw;
  if (op === "lt") return String(value) < raw;
  throw new Error(`fake store: unsupported op ${op}`);
}

/** Evaluate `and(a,b)` groups and bare terms inside an or=(...) guard. */
function evalOrGuard(row, orExpr) {
  const body = orExpr.replace(/^\(/, "").replace(/\)$/, "");
  // Split at depth zero so nested and(...) groups stay intact.
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(current); current = ""; } else current += ch;
  }
  parts.push(current);
  return parts.some((part) => {
    if (part.startsWith("and(")) {
      const inner = part.slice(4, -1);
      return inner.split(",").every((term) => evalTerm(row, term));
    }
    return evalTerm(row, part);
  });
}

/**
 * fakeStore(rows) — rows is a Map keyed by job_id. Returns store fns plus the
 * recorded writes/inserts and every select query, for the assertions below.
 */
function fakeStore(rows) {
  const writes = [];
  const inserts = [];
  const selects = [];
  const conditionalCalls = [];

  const applyPatch = (row, patch) => {
    const next = { ...row };
    for (const [k, v] of Object.entries(patch)) next[k] = v;
    next.updated_at = patch.updated_at || new Date().toISOString();
    return next;
  };

  const select = async (_table, query) => {
    selects.push(query);
    const params = query.split("&").map((p) => decodeURIComponent(p));
    let data = [...rows.values()];
    for (const param of params) {
      if (param.startsWith("or=")) {
        const expr = param.slice(3);
        data = data.filter((row) => evalOrGuard(row, expr));
      } else if (param.startsWith("job_id=eq.")) {
        const id = param.slice(10);
        data = data.filter((row) => row.job_id === id);
      } else if (param.startsWith("site_slug=eq.")) {
        const slug = param.slice(13);
        data = data.filter((row) => row.site_slug === slug);
      } else if (param === "status=eq.queued") {
        data = data.filter((row) => row.status === "queued");
      } else if (param.startsWith("limit=")) {
        data = data.slice(0, Number(param.slice(6)));
      } else if (param.startsWith("order=")) {
        // created_at.asc is the only order used; sorted below.
      }
    }
    if (params.some((p) => p.startsWith("order="))) {
      data.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }
    return { ok: true, data };
  };

  const conditionalUpdate = async (_table, _idCol, idValue, guards, patch) => {
    conditionalCalls.push({ idValue, guards, patch });
    const row = rows.get(idValue);
    if (!row) return { ok: true, mode: "live_update", updated: false, rows: [] };
    let pass = true;
    if (guards.or) pass = evalOrGuard(row, guards.or);
    for (const [col, filter] of Object.entries(guards)) {
      if (col === "or") continue;
      pass = pass && evalTerm(row, `${col}.${filter}`);
    }
    if (!pass) return { ok: true, mode: "live_update", updated: false, rows: [] };
    const next = applyPatch(row, patch);
    rows.set(idValue, next);
    return { ok: true, mode: "live_update", updated: true, rows: [next] };
  };

  const upsertRow = async (_table, row) => {
    writes.push(row);
    rows.set(row.job_id, { ...(rows.get(row.job_id) || { created_at: row.updated_at }), ...row });
    return { mode: "live_write" };
  };

  const insertRow = async (_table, row) => {
    inserts.push(row);
    if (rows.has(row.job_id)) return { mode: "live_write_failed", status: 409, error: "duplicate key" };
    rows.set(row.job_id, row);
    return { mode: "live_write" };
  };

  return { rows, writes, inserts, selects, conditionalCalls, select, conditionalUpdate, upsertRow, insertRow };
}

/** Deps for one executeEditJob call, sharing `store`, with a per-job engine. */
function runnerDeps(store, { runSiteChange, resolveTarget, events = [], notices = [] } = {}) {
  return {
    select: store.select,
    upsertRow: store.upsertRow,
    insertRow: store.insertRow,
    conditionalUpdate: store.conditionalUpdate,
    recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
    notifyOwner: async (n) => { notices.push(n); },
    deliverFollowUp: async () => ({ ok: true, skipped: "test_stub" }),
    resolveSiteEditTarget: resolveTarget || (async () => ({ projectName: "p", aliasHost: "x.wss-ai.com" })),
    runSiteChange: runSiteChange || (async () => ({ applied: true, changedFiles: ["index.html"], verified: { ok: true } })),
  };
}

function jobRow(jobId, siteSlug, over = {}) {
  const at = new Date().toISOString();
  return {
    job_id: jobId,
    site_slug: siteSlug,
    instruction: `change something on ${siteSlug}`,
    status: "queued",
    result: null,
    created_at: at,
    updated_at: at,
    ...over,
  };
}

const lockIdFor = (slug) => runner.siteLockRowId(slug);

// ---------------------------------------------------------------------------
// 1. THE CLOBBER SCENARIO — two rapid jobs, one site, both changes survive
// ---------------------------------------------------------------------------

test("two rapid jobs on one site accumulate: job2 runs only after job1's terminal write and sees job1's bytes", { timeout: 20000 }, async () => {
  const rows = new Map([
    ["edit_1", jobRow("edit_1", "air-creation", {})],
    ["edit_2", jobRow("edit_2", "air-creation", { created_at: new Date(Date.now() + 1000).toISOString() })],
  ]);
  const store = fakeStore(rows);
  const archive = { logo: "original", box: "short" }; // the site's shared bytes
  const trace = [];
  let logoSeenByJob2 = null;

  const depsFor = (jobId) => runnerDeps(store, {
    runSiteChange: async () => {
      trace.push(`${jobId}:read`);
      if (jobId === "edit_1") {
        // THE 60s+ APPLY WINDOW, compressed: edit_2 fires while edit_1 is
        // still "deploying". Under the lease, edit_2 cannot even start its
        // read until this finishes.
        await sleep(40);
        archive.logo = "big logo";
        trace.push(`${jobId}:published`);
      } else {
        logoSeenByJob2 = archive.logo; // what the pre-publish base actually held
        archive.box = "taller";
        trace.push(`${jobId}:published`);
      }
      trace.push(`${jobId}:done`);
      return { applied: true, changedFiles: ["index.html"], verified: { ok: true } };
    },
  });

  const drain = await runner.drainEditQueue({
    max: 3,
    select: store.select,
    execute: (jobId) => runner.executeEditJob(jobId, depsFor(jobId)),
  });

  assert.deepEqual(drain.ran.map((r) => r.status), ["done", "done"], "both rapid edits land");
  assert.equal(logoSeenByJob2, "big logo",
    "edit_2 planned against edit_1's PUBLISHED bytes, not the pre-edit site — the exact bytes the clobber reverted");
  assert.deepEqual(archive, { logo: "big logo", box: "taller" },
    "BOTH changes present after both deploy — the caller's complaint, inverted");
  assert.deepEqual(trace, ["edit_1:read", "edit_1:published", "edit_1:done", "edit_2:read", "edit_2:published", "edit_2:done"],
    "strict read-after-write: edit_2's read begins only after edit_1's terminal write");

  // The lease was actually taken and cleanly let go.
  const lock = rows.get(lockIdFor("air-creation"));
  assert.equal(lock.status, "lock");
  assert.equal(lock.result.lock, null, "the lease is released, not held, after the terminal write");
  assert.equal(lock.result.released_by, "edit_2");
  // And the lease row can never surface in a customer's transcript: its
  // site_slug is the underscore pseudo-slug no real site can carry.
  assert.equal(rows.get(lockIdFor("air-creation")).site_slug, "_site_lock");
});

test("concurrent callers for one site: the loser defers queued, runs nothing, and does not burn an attempt", { timeout: 20000 }, async () => {
  const rows = new Map([
    ["edit_a", jobRow("edit_a", "same-site")],
    ["edit_b", jobRow("edit_b", "same-site")],
  ]);
  const store = fakeStore(rows);
  const events = [];
  let runningNow = 0;
  let maxConcurrent = 0;

  const engine = async () => {
    runningNow += 1;
    maxConcurrent = Math.max(maxConcurrent, runningNow);
    await sleep(40);
    runningNow -= 1;
    return { applied: true, changedFiles: [], verified: { ok: true } };
  };

  const depsFor = (jobId) => runnerDeps(store, { runSiteChange: engine, events });

  const [outA, outB] = await Promise.all([
    runner.executeEditJob("edit_a", depsFor("edit_a")),
    runner.executeEditJob("edit_b", depsFor("edit_b")),
  ]);

  const winner = outA.status === "done" ? outA : outB;
  const loser = outA.status === "done" ? outB : outA;
  assert.equal(winner.status, "done");
  assert.equal(loser.status, "deferred_site_busy", "the second job WAITS; it does not run beside the first");
  assert.equal(loser.reason, "site_lock_held");
  assert.equal(maxConcurrent, 1, "only one engine run may exist for a site at any moment");

  const loserRow = rows.get(loser.jobId);
  assert.equal(loserRow.status, "queued", "a deferred job stays queued for the next pass");
  assert.equal(loserRow.result.attempts, 0, "waiting is not an attempt — the retry budget survives the wait");
  assert.equal(loserRow.result.wait_reason, "site_lock_held");
  assert.ok(events.some((e) => e.name === "ghost_agency_site_edit_deferred" && e.payload.reason === "site_lock_held"),
    "the deferral is on the record, with its named reason");

  // And the deferred job runs to completion once the site is free — the
  // released lease is claimable immediately, without waiting out any TTL.
  const second = await runner.executeEditJob(loser.jobId, depsFor(loser.jobId));
  assert.equal(second.status, "done");
  assert.equal(rows.get(lockIdFor("same-site")).result.lock, null);
});

test("a stale lease cannot hold a site hostage — a dead holder's claim is reclaimed", { timeout: 20000 }, async () => {
  const rows = new Map([
    ["edit_b", jobRow("edit_b", "stale-lock-site")],
    [lockIdFor("stale-lock-site"), {
      job_id: lockIdFor("stale-lock-site"),
      site_slug: "_site_lock",
      instruction: "per-site edit lease — not a job",
      status: "lock",
      result: { lock: "dead-token", held_by: "edit_dead_lambda", acquired_at: new Date(Date.now() - 11 * MINUTE).toISOString() },
      created_at: new Date(Date.now() - 11 * MINUTE).toISOString(),
      updated_at: new Date(Date.now() - 11 * MINUTE).toISOString(), // 11 min: past STALE_RUNNING_MS
    }],
  ]);
  const store = fakeStore(rows);
  let ran = 0;
  const out = await runner.executeEditJob("edit_b", runnerDeps(store, {
    runSiteChange: async () => { ran += 1; return { applied: true, changedFiles: [], verified: { ok: true } }; },
  }));
  assert.equal(out.status, "done", "no live worker can exist behind a 10+ minute lease (300s function cap)");
  assert.equal(ran, 1);
});

test("different sites stay parallel: neither site's lease blocks the other", { timeout: 20000 }, async () => {
  const rows = new Map([
    ["edit_s1", jobRow("edit_s1", "site-one")],
    ["edit_s2", jobRow("edit_s2", "site-two")],
  ]);
  const store = fakeStore(rows);
  let siteTwoStarted = false;
  const t0 = Date.now();

  const depsS1 = runnerDeps(store, {
    runSiteChange: async () => {
      // Site one HOLDS while waiting to observe site two running beside it.
      // Under a (wrong) global lock this wait times out and the test fails.
      while (!siteTwoStarted && Date.now() - t0 < 2000) await sleep(10);
      return { applied: true, changedFiles: [], verified: { ok: true } };
    },
  });
  const depsS2 = runnerDeps(store, {
    runSiteChange: async () => {
      siteTwoStarted = true;
      await sleep(10);
      return { applied: true, changedFiles: [], verified: { ok: true } };
    },
  });

  const [out1, out2] = await Promise.all([
    runner.executeEditJob("edit_s1", depsS1),
    runner.executeEditJob("edit_s2", depsS2),
  ]);
  assert.equal(out1.status, "done");
  assert.equal(out2.status, "done");
  assert.equal(siteTwoStarted, true, "site two ran WHILE site one was mid-flight");
  assert.notEqual(rows.get(lockIdFor("site-one")).job_id, rows.get(lockIdFor("site-two")).job_id,
    "each site owns its own lease row");
});

// ---------------------------------------------------------------------------
// 2. THE DRAIN — same-site follow-ups run in the same pass, serially
// ---------------------------------------------------------------------------

test("the drain pulls a site's next queued job into the same pass, ahead of other sites' work", { timeout: 20000 }, async () => {
  const rows = new Map();
  const order = [];
  const store = fakeStore(rows);
  rows.set("a1", jobRow("a1", "site-a"));
  rows.set("b1", jobRow("b1", "site-b", { created_at: new Date(Date.now() + 500).toISOString() }));
  // a2 is NOT in the drain's first page (it would have waited for the next
  // cron tick two minutes away — the gap the clobber's 68s spacing walked in).
  rows.set("a2", jobRow("a2", "site-a", { created_at: new Date(Date.now() + 1000).toISOString() }));

  const seenQueries = [];
  const selectTracking = async (table, query) => {
    seenQueries.push(query);
    if (query.startsWith("site_slug=eq.site-a")) {
      const hit = [...rows.values()].find((r) => r.site_slug === "site-a" && r.status === "queued");
      return { ok: true, data: hit ? [hit] : [] };
    }
    return store.select(table, query);
  };

  const drain = await runner.drainEditQueue({
    max: 3,
    select: selectTracking,
    execute: async (jobId) => {
      order.push(jobId);
      if (rows.get(jobId)) rows.get(jobId).status = "done";
      return { ok: true, jobId, status: "done" };
    },
  });

  assert.deepEqual(order, ["a1", "a2", "b1"],
    "site-a's follow-up runs immediately after site-a's leader, before site-b's older-but-different-site job");
  assert.equal(drain.ran.length, 3);
  assert.ok(seenQueries.some((q) => q.startsWith("site_slug=eq.site-a")),
    "the follow-up query is scoped to the leader's site");
});

test("the same-site pull respects the invocation budget and never runs a job twice", { timeout: 20000 }, async () => {
  const rows = new Map();
  const order = [];
  rows.set("a1", jobRow("a1", "site-a"));
  rows.set("a2", jobRow("a2", "site-a", { created_at: new Date(Date.now() + 500).toISOString() }));
  const store = fakeStore(rows);
  const drain = await runner.drainEditQueue({
    max: 1,
    select: store.select,
    execute: async (jobId) => {
      order.push(jobId);
      return { ok: true, jobId, status: "done" };
    },
  });
  assert.deepEqual(order, ["a1"], "budget 1 = one execution, whatever the pull offers");
  assert.equal(drain.ran.length, 1);
});

test("a deferral is not a terminal: it triggers no follow-up pull and the next site's job still runs", { timeout: 20000 }, async () => {
  const rows = new Map();
  const order = [];
  rows.set("a1", jobRow("a1", "site-a"));
  rows.set("b1", jobRow("b1", "site-b", { created_at: new Date(Date.now() + 500).toISOString() }));
  const store = fakeStore(rows);
  const seenQueries = [];
  const selectTracking = async (table, query) => {
    seenQueries.push(query);
    return store.select(table, query);
  };
  const drain = await runner.drainEditQueue({
    max: 3,
    select: selectTracking,
    execute: async (jobId) => {
      order.push(jobId);
      return jobId === "a1"
        ? { ok: false, jobId, status: "deferred_site_busy", reason: "site_lock_held" }
        : { ok: true, jobId, status: "done" };
    },
  });
  assert.deepEqual(order, ["a1", "b1"], "a deferred site does not consume the pass");
  assert.equal(seenQueries.filter((q) => q.startsWith("site_slug=eq.")).length, 1,
    "only the TERMINAL job triggered a site-scoped follow-up query");
});

// ---------------------------------------------------------------------------
// 3. THE STALE-BASE PATH IN THE RUNNER — requeue with a named reason, retry
// ---------------------------------------------------------------------------

test("a stale_site_base rejection is requeued for retry, never published, never called a failure", { timeout: 20000 }, async () => {
  const rows = new Map([["edit_r", jobRow("edit_r", "stale-site")]]);
  const store = fakeStore(rows);
  const events = [];
  const notices = [];
  const staleError = Object.assign(new Error("stale_site_base: the site moved under us"), {
    code: "stale_site_base",
    machinery: true,
  });
  let calls = 0;
  const deps = runnerDeps(store, {
    runSiteChange: async () => {
      calls += 1;
      if (calls === 1) throw staleError;
      return { applied: true, changedFiles: ["index.html"], verified: { ok: true } };
    },
    events,
    notices,
  });

  const first = await runner.executeEditJob("edit_r", deps);
  assert.equal(first.status, "deferred_stale_base");
  assert.equal(first.reason, "stale_site_base", "the named failure reason travels to the caller");
  let row = rows.get("edit_r");
  assert.equal(row.status, "queued", "the row goes back to the queue to replan on a fresh base");
  assert.equal(row.result.error, "stale_site_base");
  assert.equal(row.result.stale_site_base, true);
  assert.equal(row.result.say, runner.STALE_BASE_SAY);
  assert.ok(row.result.say.includes("nothing from this request went live"),
    "the sentence is provable: the guard fires before a single byte is uploaded");
  assert.equal(notices.length, 0, "no failure alarm for a retryable condition");
  assert.ok(events.some((e) => e.name === "ghost_agency_site_edit_stale_base"));

  // The retry, on a fresh base, lands.
  const second = await runner.executeEditJob("edit_r", deps);
  assert.equal(second.status, "done");
  assert.equal(calls, 2);
  assert.equal(rows.get("edit_r").status, "done");
});

test("a stale-base retrier is still bounded: attempts run out to a terminal failure with the same named reason", { timeout: 20000 }, async () => {
  const rows = new Map([["edit_x", jobRow("edit_x", "stale-site", { result: { attempts: sweeper.MAX_ATTEMPTS, stale_site_base: true } })]]);
  const store = fakeStore(rows);
  let ran = 0;
  const out = await runner.executeEditJob("edit_x", runnerDeps(store, {
    runSiteChange: async () => { ran += 1; return { applied: true }; },
  }));
  assert.equal(out.status, "failed");
  assert.equal(ran, 0, "the exhausted job starts no work");
  const row = rows.get("edit_x");
  assert.equal(row.status, "failed");
  assert.equal(row.result.error, "attempts_exhausted");
  assert.equal(row.result.say, runner.STALE_BASE_SAY,
    "a stale-base death is provably pre-upload, so its sentence says nothing went live — not the hedged abandoned line");
});

// ---------------------------------------------------------------------------
// 4. THE GUARD ITSELF — marker identity, and the pre-upload order in source
// ---------------------------------------------------------------------------

test("marker identity: rev beats legacy fields; anything unreadable is its own state", () => {
  assert.equal(plan.siteMarkerIdentity(null), "none");
  assert.equal(plan.siteMarkerIdentity({ rev: 7 }), "rev:7");
  assert.equal(plan.siteMarkerIdentity({ taken_at: "2026-08-10T22:00:00.000Z", job_id: "edit_1" }),
    "legacy:2026-08-10T22:00:00.000Z:edit_1");
});

test("assertFreshBase: same marker passes; any movement — rev bump, none→rev, legacy→rev — is stale", () => {
  assert.equal(plan.assertFreshBase({ rev: 3 }, { rev: 3 }), true);
  assert.equal(plan.assertFreshBase(null, null), true, "a site never edited has no marker and no stale base");
  assert.equal(
    plan.assertFreshBase({ taken_at: "t1", job_id: "edit_1" }, { taken_at: "t1", job_id: "edit_1" }),
    true,
    "a legacy manifest is identified by its own fields",
  );

  for (const [base, current, why] of [
    [{ rev: 1 }, { rev: 2 }, "a concurrent apply bumped the counter"],
    [null, { rev: 1 }, "the site gained its first write mid-run"],
    [{ taken_at: "t1", job_id: "edit_1" }, { rev: 1 }, "a legacy base meeting a rev'd write"],
    [{ rev: 2 }, null, "the marker vanished — assume the worst"],
  ]) {
    const err = (() => { try { plan.assertFreshBase(base, current); return null; } catch (e) { return e; } })();
    assert.ok(err, `must be stale: ${why}`);
    assert.equal(err.code, "stale_site_base", "the refusal carries the named reason");
    assert.equal(err.machinery, true, "it is a machinery error — the runner must retry, not speak a customer refusal");
    assert.match(err.message, /stale_site_base/);
  }
});

test("the guard runs before any byte is written: marker read precedes the archive pull, assert precedes the upload", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "site-change-plan.js"), "utf8");
  const baseRead = src.indexOf("const baseMarker = await readSiteMarker(siteSlug);");
  const archiveRead = src.indexOf("const rels = await listAll(siteSlug);");
  const guard = src.indexOf("assertFreshBase(baseMarker, await readSiteMarker(siteSlug));");
  const upload = src.indexOf('await track.stamp("uploading")');
  const snapshotWrite = src.indexOf("const undo = await snapshot({");

  assert.ok(baseRead > -1 && baseRead < archiveRead,
    "the base marker is read BEFORE the first archive byte, so 'marker unchanged' covers the whole read window");
  assert.ok(guard > -1 && guard > archiveRead && guard < upload,
    "the guard stands between the apply loop and the first write");
  assert.ok(guard < snapshotWrite, "the guard fires before the snapshot rewrites latest.json");
  assert.match(src, /rev: \(Number\.isFinite\(baseMarker && baseMarker\.rev\) \? baseMarker\.rev : 0\) \+ 1/,
    "each apply publishes the next revision for the following edit's guard");
});

test("the engine's marker reader treats a missing manifest as 'no writes' and anything else as a stop", async () => {
  // 404 (a site never edited) is the ONLY readable-absence. A store failure
  // must not quietly read as "nothing changed" — that is the failure mode the
  // guard exists to close.
  const missing = await plan.readManifestMarker(async () => { throw new Error("download failed latest.json: 404"); });
  assert.equal(missing, null);
  await assert.rejects(
    () => plan.readManifestMarker(async () => { throw new Error("download failed latest.json: 503"); }),
    /503/,
  );
  const parsed = await plan.readManifestMarker(async () =>
    Buffer.from(JSON.stringify({ rev: 4, taken_at: "t", job_id: "j" }), "utf8"));
  assert.deepEqual(parsed, { rev: 4, taken_at: "t", job_id: "j" });
});

// ---------------------------------------------------------------------------
// 5. LEASE HYGIENE — the lease row is never work, to any reader
// ---------------------------------------------------------------------------

test("the lease row's status is invisible to the drain and the sweeper, by query", () => {
  const runnerSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "edit-job-runner.js"), "utf8");
  const drainSrc = runnerSrc.slice(runnerSrc.indexOf("async function drainEditQueue"));
  assert.match(drainSrc, /status\.eq\.queued/, "the drain's select is pinned");
  assert.doesNotMatch(drainSrc, /status\.eq\.lock/, "the drain must never pick a lease up as a job");

  // The sweeper's contract is structural: it only ever closes queued/running
  // (asserted in edit-job-terminal-state), and a lease is neither.
  const queued = { status: "queued", created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const lease = { status: "lock", created_at: "", updated_at: "" };
  assert.equal(sweeper.classifyStuckJob(queued).state, "retryable");
  assert.equal(sweeper.classifyStuckJob(lease).state, "settled", "a lease row is not the sweeper's business");
});
