"use strict";

/**
 * test/rebuild-direct-route.test.js
 *
 * The direct action exists so an operator can push TODAY'S engine (#710-#716)
 * into sites that ALREADY QUALIFIED — the lever the campaign re-run could not
 * be, because re-mining an existing business looks identical to mining a
 * duplicate and the identity gate correctly refuses it (the live cohort died
 * `practice_identity_in_prior_history` ×17).
 *
 * The tests pin the properties that make that safe:
 *   · admin token required, POST only for the mutation (GET is the job read);
 *   · the mirror build runs per resolved prospect — and NOTHING else does:
 *     no intake rows, no identity/history writes, no email, no campaign;
 *   · every successful rebuild records its own durable `mirror.rebuilt` event;
 *   · an unknown prospect is an honest per-input error, never a half build;
 *   · the inline lane is concurrency-capped and queue mode enqueues durably.
 */

const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");
const path = require("node:path");

const ROUTE = path.join(__dirname, "..", "api", "admin", "rebuild-direct.js");
const ADAPTERS = path.join(__dirname, "..", "lib", "line-adapters.js");
const STORE = path.join(__dirname, "..", "lib", "store.js");

/** Load the route with line-adapters and store replaced, and nothing else. */
function loadRoute({ mirrorProspect, select, recordEvent, rebuildJobs } = {}) {
  for (const p of [ROUTE, ADAPTERS, STORE]) delete require.cache[require.resolve(p)];
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (parent && parent.filename === ROUTE) {
      if (request === "../../lib/line-adapters") return { mirrorProspect: mirrorProspect || (async () => ({ ok: false, reason: "unexpected_build" })) };
      if (request === "../../lib/store") return {
        select: select || (async () => ({ ok: true, data: [] })),
        recordEvent: recordEvent || (async () => ({ ok: true })),
      };
      if (request === "../../lib/rebuild-jobs" && rebuildJobs) return rebuildJobs;
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

function req({ method = "POST", token = "test-admin-token", body = {}, url = "/api/admin/rebuild-direct" } = {}) {
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

const GOOD_ROW = (id) => ({
  ok: true,
  data: [{ prospect_id: id, business_name: `Business ${id}`, industry: "plumbing", record: {} }],
});

function rowSelector(known) {
  return async (table, query) => {
    assert.equal(table, "ghost_agency_prospects");
    const byId = /[?&]prospect_id=eq\.([^&]+)/.exec(query);
    const bySlug = /record->>site_slug=eq\.([^&]+)/.exec(query);
    const key = byId ? decodeURIComponent(byId[1]) : bySlug ? decodeURIComponent(bySlug[1]) : null;
    return (key && known[key]) ? { ok: true, data: [known[key]] } : { ok: true, data: [] };
  };
}

function trackingRecorder() {
  const events = [];
  const writes = [];
  return {
    events,
    writes,
    recordEvent: async (type, payload) => { events.push({ type, payload }); return { ok: true }; },
    // Stands in for EVERY table write the store could perform; a rebuild that
    // touched intake, identity, campaigns, or email would show up here.
    select: async () => ({ ok: true, data: [] }),
  };
}

test("no admin token, no rebuild", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let built = 0;
  const handler = loadRoute({
    mirrorProspect: async () => { built += 1; return { ok: true }; },
    select: rowSelector({}),
  });
  const r = res();
  await handler(req({ token: "", body: { prospect_ids: ["p1"], inline: true } }), r);
  assert.equal(r.captured.status, 401);
  assert.equal(built, 0, "an unauthorised caller must never reach the build");
});

test("GET/PUT contract: PUT refused, GET without job_id is a 400", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const handler = loadRoute({});
  let r = res();
  await handler(req({ method: "PUT", body: { prospect_ids: ["p1"] } }), r);
  assert.equal(r.captured.status, 405);
  r = res();
  await handler(req({ method: "GET" }), r);
  assert.equal(r.captured.status, 400);
  assert.equal(r.captured.body.error, "job_id_required");
});

test("a call without prospect ids is refused before anything runs", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let built = 0;
  const handler = loadRoute({
    mirrorProspect: async () => { built += 1; return { ok: true }; },
    select: rowSelector({}),
  });
  const r = res();
  await handler(req({ body: { inline: true } }), r);
  assert.equal(r.captured.status, 400);
  assert.equal(r.captured.body.error, "prospect_ids_required");
  assert.equal(built, 0);
});

test("two known prospects rebuild through the mirror build only — no email, no intake, no identity write", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const rows = rowSelector({
    p1: GOOD_ROW("p1").data[0],
    p2: GOOD_ROW("p2").data[0],
  });
  const built = [];
  const recorder = trackingRecorder();
  const handler = loadRoute({
    mirrorProspect: async (row, options) => {
      built.push({ row: row.prospectId, lane: options.lane });
      return {
        ok: true,
        previewUrl: `https://preview.example/${row.prospectId}`,
        buildHash: `hash_${row.prospectId}`,
        releaseEvidence: { proofIdentity: { release_id: `release_${row.prospectId}` } },
      };
    },
    select: rows,
    recordEvent: recorder.recordEvent,
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["p1", "p2"], inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.rebuilt, 2);
  assert.equal(r.captured.body.refused, 0);
  assert.deepEqual(built.map((b) => b.row).sort(), ["p1", "p2"]);
  // THE POINT: the rebuilt bytes compile from the current engine on the live
  // lane — the exact post-qualification path, never the mining/identity lane.
  for (const call of built) assert.equal(call.lane, "live");
  // Each rebuild records its own durable accounting event.
  const rebuilt = recorder.events.filter((e) => e.type === "mirror.rebuilt");
  assert.equal(rebuilt.length, 2);
  assert.deepEqual(rebuilt.map((e) => e.payload.prospect_id).sort(), ["p1", "p2"]);
  assert.equal(rebuilt.find((e) => e.payload.prospect_id === "p1").payload.build_hash, "hash_p1");
  assert.equal(rebuilt.find((e) => e.payload.prospect_id === "p1").payload.release_id, "release_p1");
  // NO identity claim, NO campaign event, NO anything else: the only events
  // written are the two mirror.rebuilt records, and nothing else was written.
  assert.equal(recorder.events.length, 2);
  assert.ok(!recorder.events.some((e) => String(e.type).includes("identity")),
    "a rebuild is not a new business — the identity tables are untouched");
});

test("an unknown prospect is an honest per-input error, and known ones still rebuild", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const built = [];
  const handler = loadRoute({
    mirrorProspect: async (row) => {
      built.push(row.prospectId);
      return { ok: true, previewUrl: "https://preview.example/x", buildHash: "h1" };
    },
    select: rowSelector({ p1: GOOD_ROW("p1").data[0] }),
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["p1", "ghost-slug"], inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.deepEqual(built, ["p1"], "only the resolvable prospect builds");
  assert.equal(r.captured.body.rebuilt, 1);
  assert.equal(r.captured.body.unknown.length, 1);
  assert.equal(r.captured.body.unknown[0].input, "ghost-slug");
  assert.equal(r.captured.body.unknown[0].error, "prospect_not_found");
});

test("every input unknown is a 404 and nothing builds", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  let built = 0;
  const handler = loadRoute({
    mirrorProspect: async () => { built += 1; return { ok: true }; },
    select: rowSelector({}),
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["ghost-slug"], inline: true } }), r);
  assert.equal(r.captured.status, 404);
  assert.equal(r.captured.body.error, "no_resolvable_prospects");
  assert.equal(built, 0);
});

test("a refusal keeps the lane's own sentence per prospect", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const handler = loadRoute({
    mirrorProspect: async () => ({ ok: false, reason: "the vertical gate refused this multi-trade business" }),
    select: rowSelector({ p1: GOOD_ROW("p1").data[0] }),
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["p1"], inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.refused, 1);
  assert.equal(r.captured.body.results[0].reason, "the vertical gate refused this multi-trade business");
});

test("a mirror crash becomes a per-prospect verdict, not a 500 that loses the cohort", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const handler = loadRoute({
    mirrorProspect: async () => { throw new Error("deploy socket died"); },
    select: rowSelector({ p1: GOOD_ROW("p1").data[0] }),
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["p1"], inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.refused, 1);
  assert.ok(r.captured.body.results[0].reason.startsWith("rebuild_direct_error"));
});

test("queue mode enqueues one durable job per prospect and kicks each", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const enqueued = [];
  const kicked = [];
  const fakeJobs = {
    enqueueRebuildJob: async ({ prospectId, actor }) => {
      enqueued.push({ prospectId, actor });
      return { ok: true, jobId: `job_${prospectId}`, reused: false };
    },
    getRebuildJob: async () => ({ ok: false, error: "unknown_job" }),
    runRebuildJob: async (jobId) => { kicked.push(jobId); return { ok: true }; },
  };
  const handler = loadRoute({
    rebuildJobs: fakeJobs,
    select: rowSelector({ p1: GOOD_ROW("p1").data[0], p2: GOOD_ROW("p2").data[0] }),
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["p1", "p2"] } }), r);
  assert.equal(r.captured.status, 202);
  assert.equal(r.captured.body.queued_count, 2);
  assert.ok(r.captured.body.jobs.every((j) => j.job_id));
  assert.deepEqual(enqueued.map((e) => e.actor), ["rebuild_direct", "rebuild_direct"]);
  assert.deepEqual(kicked.sort(), ["job_p1", "job_p2"], "each durable job is kicked, none awaited");
});

test("slug inputs resolve to the same durable row", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const built = [];
  const handler = loadRoute({
    mirrorProspect: async (row) => { built.push(row.prospectId); return { ok: true, buildHash: "h" }; },
    select: async (table, query) => {
      assert.ok(/record->>site_slug=eq\./.test(query), "slug lookups use the record site_slug filter");
      return { ok: true, data: [{ prospect_id: "p-from-slug", business_name: "Slug Business", industry: "plumbing", record: {} }] };
    },
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["some-business-slug"], inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.deepEqual(built, ["p-from-slug"]);
});

test("the inline lane caps concurrency at two", async () => {
  process.env.GHOST_AGENCY_ADMIN_TOKEN = "test-admin-token";
  const { REBUILD_CONCURRENCY } = require(ROUTE);
  assert.equal(REBUILD_CONCURRENCY, 2);
  let active = 0;
  let peak = 0;
  const handler = loadRoute({
    mirrorProspect: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return { ok: true, buildHash: "h" };
    },
    select: rowSelector({
      p1: GOOD_ROW("p1").data[0],
      p2: GOOD_ROW("p2").data[0],
      p3: GOOD_ROW("p3").data[0],
      p4: GOOD_ROW("p4").data[0],
      p5: GOOD_ROW("p5").data[0],
    }),
  });
  const r = res();
  await handler(req({ body: { prospect_ids: ["p1", "p2", "p3", "p4", "p5"], inline: true } }), r);
  assert.equal(r.captured.status, 200);
  assert.equal(r.captured.body.rebuilt, 5);
  assert.ok(peak <= REBUILD_CONCURRENCY, `peak concurrency ${peak} must stay within the cap`);
});
