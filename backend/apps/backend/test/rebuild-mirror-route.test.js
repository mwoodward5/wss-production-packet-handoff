"use strict";

/**
 * test/rebuild-mirror-route.test.js
 *
 * The route exists to do ONE thing an operator could not do before: re-run a
 * mirror that already exists, through the Line's own build path, so a landed
 * fix reaches published bytes. The tests pin the properties that make that safe
 * to run across a whole fleet:
 *
 *   · admin token required, POST only for the mutation (GET is the job read);
 *   · it never sends anything;
 *   · a refusal keeps the lane's own sentence instead of being flattened;
 *   · the DEFAULT answers fast and durably (queued + kicked, never a ~127s
 *     build inside the request that owed the operator an answer) — the live
 *     504 on 2026-08-17 is why the inline path is now an explicit opt-in.
 */

const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");
const path = require("node:path");

const ROUTE = path.join(__dirname, "..", "api", "admin", "rebuild-mirror.js");
const ADAPTERS = path.join(__dirname, "..", "lib", "line-adapters.js");
const STORE = path.join(__dirname, "..", "lib", "store.js");

/** Load the route with line-adapters and store replaced, and nothing else. */
function loadRoute({ mirrorProspect, select }) {
  for (const p of [ROUTE, ADAPTERS, STORE]) delete require.cache[require.resolve(p)];
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (parent && parent.filename === ROUTE) {
      if (request === "../../lib/line-adapters") return { mirrorProspect };
      if (request === "../../lib/store") return { select };
    }
    return realLoad.call(this, request, parent, isMain);
  };
  try {
    return require(ROUTE);
  } finally {
    Module._load = realLoad;
  }
}

function res() {
  const captured = { status: 0, body: null, headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(k, v) { captured.headers[k] = v; },
    end(payload) {
      captured.status = this.statusCode;
      try { captured.body = JSON.parse(payload); } catch { captured.body = payload; }
    },
    writeHead(code) { this.statusCode = code; return this; },
  };
}

function req({ method = "POST", token = "test-admin-token", body = {}, url = "/api/admin/rebuild-mirror" } = {}) {
  const text = JSON.stringify(body);
  return {
    method,
    url,
    headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json" },
    on(event, cb) {
      if (event === "data") cb(Buffer.from(text));
      if (event === "end") cb();
      return this;
    },
    setEncoding() { return this; },
  };
}

const ROW = {
  ok: true,
  data: [{ prospect_id: "wss-test-example", business_name: "Example Plumbing", industry: "plumbing", record: {} }],
};

test("no admin token, no rebuild", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let called = 0;
  const handler = loadRoute({
    mirrorProspect: async () => { called += 1; return { ok: true }; },
    select: async () => ROW,
  });
  const r = res();
  await handler(req({ token: "", body: { prospect_id: "wss-test-example", inline: true } }), r);
  assert.equal(r.captured.status, 401);
  assert.equal(called, 0, "an unauthorised caller must never reach the build");
});

test("PUT is refused — only the mutation and the job read exist", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let called = 0;
  const handler = loadRoute({
    mirrorProspect: async () => { called += 1; return { ok: true }; },
    select: async () => ROW,
  });
  const r = res();
  await handler(req({ method: "PUT", body: { prospect_id: "wss-test-example", inline: true } }), r);
  assert.equal(r.captured.status, 405);
  assert.equal(called, 0);
});

test("a missing prospect is a 404, not a build against nothing", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let called = 0;
  const handler = loadRoute({
    mirrorProspect: async () => { called += 1; return { ok: true }; },
    select: async () => ({ ok: true, data: [] }),
  });
  const r = res();
  await handler(req({ body: { prospect_id: "nobody", inline: true } }), r);
  assert.equal(r.captured.status, 404);
  assert.equal(r.captured.body.error, "prospect_not_found");
  assert.equal(called, 0);
});

test("an explicit inline rebuild reports the published URL and the build hash", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const seen = [];
  const handler = loadRoute({
    mirrorProspect: async (row, opts) => {
      seen.push({ row, opts });
      return { ok: true, previewUrl: "https://wss-test-example.wss-ai.com/", buildHash: "abc123" };
    },
    select: async () => ROW,
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-example", inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, true);
  assert.equal(r.captured.body.queued, undefined, "the inline answer is synchronous, not a queue receipt");
  assert.equal(r.captured.body.preview_url, "https://wss-test-example.wss-ai.com/");
  assert.equal(r.captured.body.build_hash, "abc123");
  assert.equal(r.captured.body.business_name, "Example Plumbing");
  assert.equal(seen[0].row.prospectId, "wss-test-example");
  assert.equal(seen[0].opts.lane, "live", "a rebuild of a live mirror runs in the live lane");
});

test("an inline refusal keeps the lane's own sentence", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const sentence = "multi-trade business (plumbing + hvac) — a single-trade mirror would misrepresent them";
  const handler = loadRoute({
    mirrorProspect: async () => ({ ok: false, reason: sentence }),
    select: async () => ROW,
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-example", inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, false);
  assert.equal(r.captured.body.reason, sentence, "the refusal is passed through verbatim");
});

test("an inline refusal with no reason still says so out loud", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const handler = loadRoute({
    mirrorProspect: async () => ({ ok: false }),
    select: async () => ROW,
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-example", inline: true } }), r);
  assert.equal(r.captured.body.reason, "refused_without_a_reason");
});

// ---------------------------------------------------------------------------
// THE DURABLE PATH (the 2026-08-17 504 fix). The default answers fast; the
// build runs in the kicked worker / the cron sweeper, never in the request.
// ---------------------------------------------------------------------------

// Obtained through the patched loader, never a bare require: this environment
// has no mirror-engine dependencies installed, and the real line-adapters
// chain must not load outside a stubbed harness.
const { createRebuildMirrorHandler } = loadRoute({
  mirrorProspect: async () => ({ ok: true }),
  select: async () => ROW,
});

function jobsFake(overrides = {}) {
  const calls = { enqueued: [], kicks: [], reads: [] };
  const fake = {
    calls,
    async enqueueRebuildJob(input) {
      calls.enqueued.push(input);
      if (overrides.enqueueError) return { ok: false, error: overrides.enqueueError };
      return { ok: true, jobId: "rebuild_job_1", prospectId: input.prospectId, status: "queued" };
    },
    async getRebuildJob(jobId) {
      calls.reads.push(jobId);
      if (overrides.job === null) return { ok: false, error: "unknown_job" };
      if (overrides.readError) return { ok: false, error: overrides.readError };
      return {
        ok: true,
        job: {
          jobId,
          prospectId: "wss-test-example",
          status: overrides.jobStatus || "done",
          attempts: 0,
          claim: "",
          result: overrides.jobResult === undefined
            ? {
              ok: true,
              preview_url: "https://wss-test-example.wss-ai.com/",
              build_hash: "abc123",
              reason: "",
              terminal: "",
              business_name: "Example Plumbing",
              seconds: 127,
            }
            : overrides.jobResult,
        },
      };
    },
    async runRebuildJob(jobId) { return { ok: true, jobId, status: "done" }; },
  };
  return fake;
}

test("the DEFAULT is the durable queue: 202, jobId, and no build inside the request", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let mirrorRuns = 0;
  const jobs = jobsFake();
  const kicks = [];
  const handler = createRebuildMirrorHandler({
    mirrorProspect: async () => { mirrorRuns += 1; return { ok: true }; },
    select: async () => ROW,
    rebuildJobs: jobs,
    kick: (jobId) => { kicks.push(jobId); },
  });
  const r = res();
  const started = Date.now();
  await handler(req({ body: { prospect_id: "wss-test-example" } }), r);
  const elapsed = Date.now() - started;
  assert.equal(r.captured.status, 202);
  assert.equal(r.captured.body.ok, true);
  assert.equal(r.captured.body.queued, true);
  assert.equal(r.captured.body.jobId, "rebuild_job_1");
  assert.equal(r.captured.body.job_id, "rebuild_job_1", "the job id is spelled both ways the fleet spells ids");
  assert.equal(r.captured.body.status, "queued");
  assert.equal(r.captured.body.business_name, "Example Plumbing");
  assert.ok(r.captured.body.poll.path.includes("job_id=rebuild_job_1"), "the receipt says where to poll");
  assert.deepEqual(jobs.calls.enqueued, [{ prospectId: "wss-test-example", actor: "operator" }]);
  assert.deepEqual(kicks, ["rebuild_job_1"], "the worker is kicked the moment the job is durable");
  assert.equal(mirrorRuns, 0, "the request itself must never run the ~127s build — that is the 504");
  assert.ok(elapsed < 2000, "the queue receipt is fast by construction");
});

test("an explicit queue:true gets the same durable receipt", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const jobs = jobsFake();
  const handler = createRebuildMirrorHandler({
    mirrorProspect: async () => ({ ok: true }),
    select: async () => ROW,
    rebuildJobs: jobs,
    kick: () => {},
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-example", queue: true } }), r);
  assert.equal(r.captured.status, 202);
  assert.equal(r.captured.body.queued, true);
});

test("a queue that cannot persist refuses honestly instead of building inline", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let mirrorRuns = 0;
  const handler = createRebuildMirrorHandler({
    mirrorProspect: async () => { mirrorRuns += 1; return { ok: true }; },
    select: async () => ROW,
    rebuildJobs: jobsFake({ enqueueError: "rebuild_queue_unavailable" }),
    kick: () => {},
  });
  const r = res();
  await handler(req({ body: { prospect_id: "wss-test-example" } }), r);
  assert.equal(r.captured.status, 503);
  assert.equal(r.captured.body.error, "rebuild_queue_unavailable");
  assert.equal(mirrorRuns, 0, "a persistence outage must not fall back into the 300s inline build");
});

test("GET ?job_id= reads the job status, admin-gated", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const jobs = jobsFake();
  const handler = createRebuildMirrorHandler({
    mirrorProspect: async () => ({ ok: true }),
    select: async () => ROW,
    rebuildJobs: jobs,
    kick: () => {},
  });
  const denied = res();
  await handler(req({ method: "GET", token: "", url: "/api/admin/rebuild-mirror?job_id=rebuild_job_1" }), denied);
  assert.equal(denied.captured.status, 401);

  const missing = res();
  await handler(req({ method: "GET", url: "/api/admin/rebuild-mirror" }), missing);
  assert.equal(missing.captured.status, 400);
  assert.equal(missing.captured.body.error, "job_id_required");

  const r = res();
  await handler(req({ method: "GET", url: "/api/admin/rebuild-mirror?job_id=rebuild_job_1" }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.job_id, "rebuild_job_1");
  assert.equal(r.captured.body.status, "done");
  assert.equal(r.captured.body.ok, true);
  assert.equal(r.captured.body.preview_url, "https://wss-test-example.wss-ai.com/");
  assert.equal(r.captured.body.build_hash, "abc123");
});

test("a finished job's refusal keeps the lane's own sentence in the status read", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const sentence = "multi-trade business (plumbing + hvac) — a single-trade mirror would misrepresent them";
  const handler = createRebuildMirrorHandler({
    mirrorProspect: async () => ({ ok: true }),
    select: async () => ROW,
    rebuildJobs: jobsFake({ jobStatus: "done", jobResult: { ok: false, reason: sentence, terminal: "rejected" } }),
    kick: () => {},
  });
  const r = res();
  await handler(req({ method: "GET", url: "/api/admin/rebuild-mirror?job_id=rebuild_job_1" }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.ok, false);
  assert.equal(r.captured.body.reason, sentence);
  assert.equal(r.captured.body.terminal, "rejected");
});

test("GET for an unknown job is a 404 and an unreadable queue is a 503", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const unknown = createRebuildMirrorHandler({
    mirrorProspect: async () => ({ ok: true }),
    select: async () => ROW,
    rebuildJobs: jobsFake({ job: null }),
    kick: () => {},
  });
  const r1 = res();
  await unknown(req({ method: "GET", url: "/api/admin/rebuild-mirror?job_id=nope" }), r1);
  assert.equal(r1.captured.status, 404);
  assert.equal(r1.captured.body.error, "unknown_job");

  const down = createRebuildMirrorHandler({
    mirrorProspect: async () => ({ ok: true }),
    select: async () => ROW,
    rebuildJobs: jobsFake({ readError: "rebuild_queue_unavailable" }),
    kick: () => {},
  });
  const r2 = res();
  await down(req({ method: "GET", url: "/api/admin/rebuild-mirror?job_id=rebuild_job_1" }), r2);
  assert.equal(r2.captured.status, 503);
});

test("GHOST_AGENCY_REBUILD_DEFAULT_MODE=inline restores the synchronous fleet default", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const prior = process.env.GHOST_AGENCY_REBUILD_DEFAULT_MODE;
  process.env.GHOST_AGENCY_REBUILD_DEFAULT_MODE = "inline";
  try {
    const handler = createRebuildMirrorHandler({
      mirrorProspect: async () => ({ ok: true, previewUrl: "https://wss-test-example.wss-ai.com/", buildHash: "abc123" }),
      select: async () => ROW,
      rebuildJobs: jobsFake(),
      kick: () => { throw new Error("the kick must not fire in inline mode"); },
    });
    const r = res();
    await handler(req({ body: { prospect_id: "wss-test-example" } }), r);
    assert.equal(r.captured.status, 200);
    assert.equal(r.captured.body.preview_url, "https://wss-test-example.wss-ai.com/");
    assert.equal(r.captured.body.queued, undefined);
  } finally {
    if (prior === undefined) delete process.env.GHOST_AGENCY_REBUILD_DEFAULT_MODE;
    else process.env.GHOST_AGENCY_REBUILD_DEFAULT_MODE = prior;
  }
});

test("the route's dependency list contains no send path", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(ROUTE, "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const dep of requires) {
    assert.ok(
      !/email|resend|twilio|sms|autosend|outreach|queue/i.test(dep),
      `a rebuild route must not be able to reach ${dep}`,
    );
  }
  assert.deepEqual(
    requires.sort(),
    [
      "../../lib/admin-auth",
      "../../lib/http",
      "../../lib/line-adapters",
      "../../lib/prospects",
      "../../lib/rebuild-jobs",
      "../../lib/store",
    ],
  );
});

test("the rebuild worker dependency stays out of the route file's send reach", () => {
  const fs = require("node:fs");
  const rebuildWorker = path.join(__dirname, "..", "lib", "rebuild-jobs.js");
  const captureModule = path.join(__dirname, "..", "lib", "line-email-assets.js");
  const src = fs.readFileSync(rebuildWorker, "utf8");
  const requires = [...src.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.ok(
    requires.includes("./line-email-assets"),
    "the rebuild worker may reach only the existing proof-capture facade",
  );
  for (const dep of requires) {
    if (dep === "./line-email-assets") continue;
    assert.ok(
      !/email|resend|twilio|sms|autosend|outreach/i.test(dep),
      `the rebuild worker must not be able to reach ${dep}`,
    );
  }

  const captureSrc = fs.readFileSync(captureModule, "utf8");
  const captureRequires = [...captureSrc.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(captureRequires)].sort(),
    ["./line-motion-shot", "./line-proof-shots", "./proof-storage"],
    "the allowed facade must remain capture-only",
  );
});
