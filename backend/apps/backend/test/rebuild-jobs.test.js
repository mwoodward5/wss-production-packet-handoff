"use strict";

/**
 * test/rebuild-jobs.test.js — the durable rebuild worker, proven without a
 * network. The memory store below honours the same guards PostgREST does
 * (status eq, result->>claim eq), so the claim/settle exclusivity these tests
 * pin is the exclusivity production gets.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRebuildJobs,
  newRebuildJobId,
  publicVerdict,
  STALE_RUNNING_MS,
  MAX_ATTEMPTS,
  DEFAULT_DRAIN_MAX,
} = require("../lib/rebuild-jobs");

const START = Date.parse("2026-08-17T12:00:00.000Z");

class MemoryJobStore {
  constructor({ clock }) {
    this.clock = clock;
    this.jobs = new Map();
    this.prospects = new Map();
    this.events = [];
  }

  iso() {
    return new Date(this.clock()).toISOString();
  }

  seedProspect(prospectId, fields = {}) {
    this.prospects.set(prospectId, {
      prospect_id: prospectId,
      business_name: "Example Plumbing",
      industry: "plumbing",
      updated_at: this.iso(),
      record: { current_website: "https://example-plumbing.test/" },
      ...fields,
    });
  }

  job(jobId) {
    const row = this.jobs.get(jobId);
    return row ? structuredClone(row) : null;
  }

  async insertRow(table, row) {
    if (table !== "ghost_agency_rebuild_jobs") return { ok: false };
    if (this.jobs.has(row.job_id)) return { ok: false, mode: "live_write_failed" };
    this.jobs.set(row.job_id, { id: this.jobs.size + 1, ...structuredClone(row) });
    return { ok: true, mode: "live_write", data: [structuredClone(row)] };
  }

  async select(table, query = "") {
    const params = new URLSearchParams(String(query || "").replace(/^\?/, ""));
    if (table === "ghost_agency_prospects") {
      const id = (params.get("prospect_id") || "").replace(/^eq\./, "");
      const data = this.prospects.has(id) ? [structuredClone(this.prospects.get(id))] : [];
      return { ok: true, mode: "live_select", data };
    }
    if (table !== "ghost_agency_rebuild_jobs") return { ok: true, mode: "live_select", data: [] };
    let rows = [...this.jobs.values()];
    const jobId = (params.get("job_id") || "").replace(/^eq\./, "");
    if (jobId) rows = rows.filter((row) => row.job_id === jobId);
    const status = (params.get("status") || "").replace(/^eq\./, "");
    if (status) rows = rows.filter((row) => row.status === status);
    const order = params.get("order") || "";
    if (order.startsWith("created_at")) {
      rows.sort((left, right) => String(left.created_at).localeCompare(String(right.created_at)));
    } else if (order.startsWith("updated_at")) {
      rows.sort((left, right) => String(left.updated_at).localeCompare(String(right.updated_at)));
    }
    const limit = Number.parseInt(params.get("limit") || "", 10);
    if (Number.isInteger(limit) && limit >= 0) rows = rows.slice(0, limit);
    return { ok: true, mode: "live_select", data: rows.map((row) => structuredClone(row)) };
  }

  async conditionalUpdate(table, idColumn, idValue, guards, patch) {
    if (table === "ghost_agency_prospects") {
      const currentProspect = this.prospects.get(idValue);
      if (!currentProspect) return { ok: true, mode: "live_update", updated: false, rows: [] };
      const wantedVersion = String(guards?.updated_at || "").replace(/^eq\./, "");
      if (wantedVersion && String(currentProspect.updated_at || "") !== wantedVersion) {
        return { ok: true, mode: "live_update", updated: false, rows: [] };
      }
      const nextProspect = { ...currentProspect, ...structuredClone(patch) };
      this.prospects.set(idValue, nextProspect);
      return { ok: true, mode: "live_update", updated: true, rows: [structuredClone(nextProspect)] };
    }
    const current = this.jobs.get(idValue);
    const guardEntries = Object.entries(guards || {});
    if (!current) return { ok: true, mode: "live_update", updated: false, rows: [] };
    for (const [key, filter] of guardEntries) {
      const wanted = String(filter).replace(/^eq\./, "");
      if (key === "status") {
        if (current.status !== wanted) return { ok: true, mode: "live_update", updated: false, rows: [] };
      } else if (key === "result->>claim") {
        const claim = current.result && typeof current.result === "object" ? current.result.claim : "";
        if (String(claim || "") !== wanted) return { ok: true, mode: "live_update", updated: false, rows: [] };
      }
    }
    const next = { ...current, ...structuredClone(patch), id: current.id };
    this.jobs.set(idValue, next);
    return { ok: true, mode: "live_update", updated: true, rows: [structuredClone(next)] };
  }

  async recordEvent(type, payload) {
    this.events.push({ type, payload });
    return { ok: true };
  }
}

function harness(options = {}) {
  let time = options.start == null ? START : options.start;
  const clock = () => time;
  const store = new MemoryJobStore({ clock });
  const mirrorCalls = [];
  const wakeCalls = [];
  const jobs = createRebuildJobs({
    insertRow: (t, r) => store.insertRow(t, r),
    select: (t, q) => store.select(t, q),
    conditionalUpdate: (t, c, v, g, p) => store.conditionalUpdate(t, c, v, g, p),
    recordEvent: (type, payload) => store.recordEvent(type, payload),
    now: () => new Date(clock()),
    newJobId: options.newJobId || (() => `rebuild_test_${store.jobs.size + 1}`),
    captureLineEmailAssets: async ({ buildHash }) => ({
      ok: true,
      shots: {
        build_hash: buildHash,
        old_captured_url: "https://proof.example/old.webp",
        old_shot_sha: "a".repeat(64),
        new_captured_url: "https://proof.example/new.webp",
        new_shot_sha: "b".repeat(64),
      },
      results: [],
    }),
    wakeLineForCompletedHero: async (prospectId, lineHandle) => {
      wakeCalls.push({ prospectId, lineHandle });
      return { accepted: false, recovery: "cron" };
    },
  });
  const mirror = options.mirrorProspect || (async (row, opts) => {
    mirrorCalls.push({ row, opts });
    if (options.mirrorThrows) throw new Error("deploy exploded");
    return options.mirrorOut || { ok: true, previewUrl: "https://wss-test-example.wss-ai.com/", buildHash: "abc123" };
  });
  return {
    store, jobs, mirrorCalls, wakeCalls, mirror, clock,
    advance(ms) { time += ms; },
    async enqueue(prospectId = "wss-test-example") {
      store.seedProspect(prospectId);
      return jobs.enqueueRebuildJob({ prospectId, actor: "operator" });
    },
  };
}

test("enqueue writes one durable queued row and nothing else", async () => {
  const h = harness();
  const out = await h.enqueue();
  assert.equal(out.ok, true);
  assert.equal(out.status, "queued");
  const row = h.store.job(out.jobId);
  assert.equal(row.status, "queued");
  assert.equal(row.prospect_id, "wss-test-example");
  assert.equal(row.attempts, 0);
  assert.equal(row.result, null);
});

test("hero upload retries reuse one deterministic rebuild and reject changed Line lineage", async () => {
  const h = harness();
  const lineHandle = { batchId: "line_client", rowId: "line_client:0" };
  h.store.seedProspect("wss-test-example");
  const input = {
    prospectId: "wss-test-example",
    actor: "hero_clip_upload",
    heroJobId: "hrj_client",
    heroClipSha256: "c".repeat(64),
    lineHandle,
  };
  const [first, retry] = await Promise.all([
    h.jobs.enqueueRebuildJob(input),
    h.jobs.enqueueRebuildJob(input),
  ]);
  assert.equal(first.ok, true);
  assert.equal(retry.ok, true);
  assert.equal(first.jobId, retry.jobId);
  assert.equal(h.store.jobs.size, 1);
  assert.equal([first.reused, retry.reused].filter(Boolean).length, 1);
  const row = h.store.job(first.jobId);
  assert.equal(row.result.hero_job_id, "hrj_client");
  assert.equal(row.result.hero_clip_sha256, "c".repeat(64));
  assert.deepEqual(row.result.line_handle, lineHandle);

  const conflict = await h.jobs.enqueueRebuildJob({
    ...input,
    lineHandle: { ...lineHandle, rowId: "line_client:9" },
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, "rebuild_idempotency_conflict");
  assert.equal(h.store.jobs.size, 1);

  const newClip = await h.jobs.enqueueRebuildJob({
    ...input,
    heroClipSha256: "d".repeat(64),
  });
  assert.equal(newClip.ok, true);
  assert.notEqual(newClip.jobId, first.jobId);
  assert.equal(h.store.jobs.size, 2, "a newly approved clip earns a distinct rebuild");
});

test("runRebuildJob claims, rebuilds in the live lane, and settles the verbatim verdict", async () => {
  const h = harness();
  const enqueued = await h.enqueue();
  const out = await h.jobs.runRebuildJob(enqueued.jobId, { mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  assert.equal(out.ok, true);
  assert.equal(out.status, "done");
  assert.equal(out.verdict.ok, true);
  assert.equal(out.verdict.preview_url, "https://wss-test-example.wss-ai.com/");
  assert.equal(out.verdict.build_hash, "abc123");
  assert.equal(out.verdict.business_name, "Example Plumbing");
  const row = h.store.job(enqueued.jobId);
  assert.equal(row.status, "done");
  assert.equal(row.result.ok, true);
  assert.equal(row.result.preview_url, "https://wss-test-example.wss-ai.com/");
  assert.equal(h.mirrorCalls.length, 1);
  assert.equal(h.mirrorCalls[0].row.prospectId, "wss-test-example");
  assert.equal(h.mirrorCalls[0].row.vertical, "plumbing", "the worker re-reads the durable row, never a stale payload");
  assert.equal(h.mirrorCalls[0].opts.lane, "live", "a rebuild of a live mirror runs in the live lane");
  assert.equal(h.mirrorCalls[0].opts.heroRebuild, true, "the verified reel rebuild cannot wait on itself");
  assert.equal(h.mirrorCalls[0].opts.operationKey, enqueued.jobId, "a reclaimed job reuses one durable build identity");
  assert.equal(out.verdict.proof_shots_ready, true);
  assert.equal(out.verdict.proof_build_hash, "abc123");
  assert.equal(h.store.prospects.get("wss-test-example").record.proof_shots.build_hash, "abc123");
  assert.ok(h.store.events.some((event) => event.type === "rebuild_mirror.job"));
});

test("a lane refusal is a FINISHED job whose sentence survives verbatim", async () => {
  const sentence = "multi-trade business (plumbing + hvac) — a single-trade mirror would misrepresent them";
  const h = harness({ mirrorOut: { ok: false, reason: sentence, terminal: "rejected" } });
  const enqueued = await h.enqueue();
  const out = await h.jobs.runRebuildJob(enqueued.jobId, { mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  assert.equal(out.status, "done", "a refusal is a verdict, not a queue failure");
  assert.equal(out.verdict.ok, false);
  assert.equal(out.verdict.reason, sentence);
  assert.equal(out.verdict.terminal, "rejected");
  const row = h.store.job(enqueued.jobId);
  assert.equal(row.status, "done");
  assert.equal(row.result.reason, sentence);
});

test("a build that throws settles failed with a safe reason, without crashing the worker", async () => {
  const h = harness({ mirrorThrows: true });
  const enqueued = await h.enqueue();
  const out = await h.jobs.runRebuildJob(enqueued.jobId, { mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  assert.equal(out.ok, false);
  assert.equal(out.status, "failed");
  assert.match(out.reason, /^rebuild_mirror_error:/);
  const row = h.store.job(enqueued.jobId);
  assert.equal(row.status, "failed");
});

test("two workers cannot build the same job: the second answers in_flight, mirror ran once", async () => {
  const h = harness();
  const enqueued = await h.enqueue();
  const first = h.jobs.runRebuildJob(enqueued.jobId, { mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  const second = await h.jobs.runRebuildJob(enqueued.jobId, { mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  await first;
  assert.equal(second.ok, false);
  assert.equal(second.error, "in_flight");
  assert.equal(h.mirrorCalls.length, 1);
});

test("a stale running claim is requeued until its attempts run out, then closed", async () => {
  const h = harness();
  const enqueued = await h.enqueue();
  const claimDead = (token) => h.store.conditionalUpdate(
    "ghost_agency_rebuild_jobs", "job_id", enqueued.jobId,
    { status: "eq.queued" },
    { status: "running", result: { claim: token }, updated_at: h.store.iso() },
  );
  // Simulate a worker that claimed and died: running row, no settle.
  assert.equal((await claimDead("dead-workers-token")).updated, true);

  // Fresh: untouched.
  h.advance(STALE_RUNNING_MS - 1000);
  assert.deepEqual(await h.jobs.sweepStaleRebuildJobs(), { ok: true, requeued: [], closed: [] });

  // Stale: requeued, attempts + 1.
  h.advance(STALE_RUNNING_MS + 1000);
  const swept1 = await h.jobs.sweepStaleRebuildJobs();
  assert.deepEqual(swept1.requeued, [enqueued.jobId]);
  assert.equal(h.store.job(enqueued.jobId).status, "queued");
  assert.equal(h.store.job(enqueued.jobId).attempts, 1);

  // Burn the remaining attempts with more dead workers; the sweep that sees
  // attempts hit the cap closes the job honestly instead of requeueing again.
  while (h.store.job(enqueued.jobId).attempts < MAX_ATTEMPTS - 1) {
    await claimDead("dead-again");
    h.advance(STALE_RUNNING_MS + 1000);
    await h.jobs.sweepStaleRebuildJobs();
  }
  await claimDead("dead-final");
  h.advance(STALE_RUNNING_MS + 1000);
  const final = await h.jobs.sweepStaleRebuildJobs();
  assert.deepEqual(final.requeued, []);
  assert.deepEqual(final.closed, [enqueued.jobId]);
  const row = h.store.job(enqueued.jobId);
  assert.equal(row.status, "failed");
  assert.equal(row.result.reason, "rebuild_retry_exhausted");
});

test("a zombie worker's late verdict cannot overwrite a reclaimed job", async () => {
  const h = harness();
  const enqueued = await h.enqueue();
  // Worker A claims, dies past STALE_RUNNING_MS.
  await h.store.conditionalUpdate(
    "ghost_agency_rebuild_jobs", "job_id", enqueued.jobId,
    { status: "eq.queued" },
    { status: "running", result: { claim: "worker-a" }, updated_at: h.store.iso() },
  );
  h.advance(STALE_RUNNING_MS + 1000);
  await h.jobs.sweepStaleRebuildJobs(); // requeued
  // Worker B claims and finishes.
  const finished = await h.jobs.runRebuildJob(enqueued.jobId, { mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  assert.equal(finished.status, "done");
  // Worker A wakes up and tries to settle over B's row: the claim guard wins.
  const zombie = await h.jobs.settleRebuildJob(enqueued.jobId, "worker-a", "done", {
    ok: true, preview_url: "https://zombie.example/", build_hash: "zzz",
  });
  assert.equal(zombie.ok, false, "a zombie's settle must lose to the living worker's claim");
  assert.equal(h.store.job(enqueued.jobId).result.build_hash, "abc123", "B's verdict is the one that survived");
});

test("drain runs the oldest queued jobs and stops at the honest per-pass budget", async () => {
  const h = harness();
  for (let index = 1; index <= 4; index += 1) {
    const out = await h.enqueue(`wss-prospect-${index}`);
    h.advance(1000);
    assert.equal(out.ok, true);
  }
  const out = await h.jobs.drainRebuildJobs({ max: 2, mirrorProspect: h.mirror, select: (t, q) => h.store.select(t, q) });
  assert.equal(out.ok, true);
  assert.equal(out.drained, 2, "one rebuild is ~127s of a 300s function; two per pass is the honest cap");
  const done = [...h.store.jobs.values()].filter((row) => row.status === "done");
  assert.equal(done.length, 2);
  assert.ok(done.every((row) => /^wss-prospect-[12]$/.test(row.prospect_id)), "oldest first");
  assert.equal(DEFAULT_DRAIN_MAX, 2);
});

test("drain tolerates an unavailable queue and says so", async () => {
  const jobs = createRebuildJobs({
    insertRow: async () => ({ ok: false }),
    select: async () => ({ ok: false, mode: "live_select_failed" }),
    conditionalUpdate: async () => ({ ok: false }),
    recordEvent: async () => ({ ok: true }),
    now: () => new Date(START),
  });
  const out = await jobs.drainRebuildJobs({});
  assert.equal(out.ok, false);
  assert.equal(out.error, "rebuild_queue_unavailable");
});

test("publicVerdict keeps the inline route's exact answer shape", () => {
  const verdict = publicVerdict({
    jobId: "rebuild_x",
    prospectId: "wss-x",
    status: "done",
    result: { ok: true, preview_url: "https://x/", build_hash: "h", business_name: "X Plumbing", seconds: 127 },
  });
  assert.deepEqual(Object.keys(verdict).sort(), [
    "build_hash", "business_name", "job_id", "ok", "preview_url", "proof_build_hash", "proof_reason", "proof_shots_ready", "prospect_id", "reason", "seconds", "status", "terminal",
  ]);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, "", "a success carries no refusal sentence");
  const refused = publicVerdict({
    jobId: "rebuild_y",
    prospectId: "wss-y",
    status: "done",
    result: {},
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "refused_without_a_reason");
});

test("newRebuildJobId is unique and namespaced", () => {
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) {
    const id = newRebuildJobId();
    assert.match(id, /^rebuild_[a-z0-9]+_[a-f0-9]{10}$/);
    seen.add(id);
  }
  assert.equal(seen.size, 200);
});

test("the cron entry sweeps the dead, drains the living, and echoes no facts", async () => {
  const { createRunRebuildMirrorJobsHandler } = require("../api/cron/run-rebuild-mirror-jobs");
  const calls = [];
  const handler = createRunRebuildMirrorJobsHandler({
    requireCron: (req, res) => true,
    methodGuard: (req, res, methods) => methods.includes(req.method),
    sendJson: (res, status, body) => { res.statusCode = status; res.body = body; },
    rebuildJobs: {
      sweepStaleRebuildJobs: async () => { calls.push("sweep"); return { ok: true, requeued: ["j1"], closed: ["j2"] }; },
      drainRebuildJobs: async () => { calls.push("drain"); return { ok: true, drained: 2, failed: 0, skipped: 0 }; },
    },
  });
  const res = { statusCode: 0, body: null };
  await handler({ method: "GET", url: "/api/cron/run-rebuild-mirror-jobs" }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.drained, 2);
  assert.equal(res.body.swept_requeued, 1);
  assert.equal(res.body.swept_closed, 1);
  assert.deepEqual(calls, ["sweep", "drain"], "close the dead before re-running the living");
  assert.ok(!JSON.stringify(res.body).includes("prospect"), "counts only, never facts");
});

test("the cron entry refuses callers without the cron secret", async () => {
  const { createRunRebuildMirrorJobsHandler } = require("../api/cron/run-rebuild-mirror-jobs");
  const handler = createRunRebuildMirrorJobsHandler({
    requireCron: (req, res) => { res.statusCode = 401; res.body = { ok: false }; return false; },
    methodGuard: () => true,
    sendJson: () => { throw new Error("must not send after a cron refusal"); },
    rebuildJobs: { sweepStaleRebuildJobs: async () => { throw new Error("must not run"); }, drainRebuildJobs: async () => { throw new Error("must not run"); } },
  });
  const res = { statusCode: 0, body: null };
  await handler({ method: "POST" }, res);
  assert.equal(res.statusCode, 401);
});
