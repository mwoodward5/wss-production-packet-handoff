"use strict";
// Contract tests for the VAPI tool Riley uses to report a website edit.

const test = require("node:test");
const assert = require("node:assert/strict");

const HANDLER_PATH = require.resolve("../api/vapi-tools/site-edit-status");
const STATUS_CORE_PATH = require.resolve("../lib/edit-status-core");
const EDIT_CORE_PATH = require.resolve("../lib/site-edit-core");
const STORE_PATH = require.resolve("../lib/store");

const SECRET = "test-secret-for-site-edit-status";
const JOB = "edit_1700000000000_abc123";

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.body = payload; },
  };
}

function vapiEnvelope(args, { asString = true, id = "call_abc" } = {}) {
  return {
    message: {
      type: "tool-calls",
      toolCalls: [{
        id,
        type: "function",
        function: {
          name: "site_edit_status",
          arguments: asString ? JSON.stringify(args) : args,
        },
      }],
    },
  };
}

async function callTool(handler, body, { secret = SECRET } = {}) {
  const res = mockRes();
  await handler({ method: "POST", headers: { "x-vapi-secret": secret }, body, query: {} }, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch { json = null; }
  return { status: res.statusCode, json };
}

function payloadOf(json) {
  if (json && Array.isArray(json.results) && json.results[0]) {
    return JSON.parse(json.results[0].result);
  }
  return json;
}

// The status route and edit-progress reader both receive this same select stub.
// A job lookup names JOB; the progress meter's history read asks for completed
// rows and must be allowed to return an empty measurement set.
function withStubbedJob(job, fn, { historyRows = [] } = {}) {
  const savedSecret = process.env.VAPI_TOOL_SECRET;
  delete require.cache[HANDLER_PATH];
  // The tool core is the module that binds lib/store; it must reload with the
  // stub below, exactly as the route shell does.
  delete require.cache[STATUS_CORE_PATH];
  delete require.cache[EDIT_CORE_PATH];
  delete require.cache[STORE_PATH];
  const store = require("../lib/store");
  const storedJob = job ? { job_id: JOB, site_slug: "example-site", ...job } : null;
  store.select = async (table, query) => {
    assert.equal(table, "ghost_agency_edit_jobs");
    if (String(query).includes("status=eq.done")) {
      return { ok: true, data: historyRows };
    }
    assert.match(query, new RegExp(JOB));
    return { ok: true, data: storedJob ? [storedJob] : [] };
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  const handler = require("../api/vapi-tools/site-edit-status");
  return (async () => {
    try {
      return await fn(handler);
    } finally {
      delete require.cache[HANDLER_PATH];
      delete require.cache[STATUS_CORE_PATH];
      delete require.cache[EDIT_CORE_PATH];
      delete require.cache[STORE_PATH];
      if (savedSecret === undefined) delete process.env.VAPI_TOOL_SECRET;
      else process.env.VAPI_TOOL_SECRET = savedSecret;
    }
  })();
}

test("a real VAPI call with string arguments is answered", () =>
  withStubbedJob({
    status: "done",
    result: { say: "Done — your change is live." },
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const response = await callTool(handler, vapiEnvelope({ jobId: JOB }));
    assert.equal(response.status, 200);
    const payload = payloadOf(response.json);
    assert.equal(payload.ok, true);
    assert.equal(payload.jobId, JOB);
    assert.equal(payload.status, "done");
  }));

test("the object form still works", () =>
  withStubbedJob({
    status: "running",
    result: {},
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const response = await callTool(handler, vapiEnvelope({ jobId: JOB }, { asString: false }));
    assert.equal(response.status, 200);
    assert.equal(payloadOf(response.json).status, "running");
  }));

test("the answer is bound to the tool call it answers", () =>
  withStubbedJob({
    status: "done",
    result: {},
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const response = await callTool(handler, vapiEnvelope({ jobId: JOB }, { id: "call_xyz" }));
    assert.ok(Array.isArray(response.json.results));
    assert.equal(response.json.results[0].toolCallId, "call_xyz");
  }));

test("the worker's own sentence is preferred over a generic line", () =>
  withStubbedJob({
    status: "refused",
    result: { say: "I couldn't back that claim up from your site, so I left it alone." },
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const payload = payloadOf((await callTool(handler, vapiEnvelope({ jobId: JOB }))).json);
    assert.match(payload.say, /couldn't back that claim up/);
  }));

test("legacy phantom-team promises are never repeated to the caller", () =>
  withStubbedJob({
    status: "refused",
    result: { say: "Someone on our team is picking it up, and nothing on your site has changed." },
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const payload = payloadOf((await callTool(handler, vapiEnvelope({ jobId: JOB }))).json);
    assert.doesNotMatch(payload.say, /someone on (?:our|the) team|team is picking|flagged it for the team/i);
    assert.match(payload.say, /recorded as refused/i);
  }));

test("failed fallback reports the recorded failure without inventing a handoff", () =>
  withStubbedJob({
    status: "failed",
    result: {},
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const payload = payloadOf((await callTool(handler, vapiEnvelope({ jobId: JOB }))).json);
    assert.match(payload.say, /failure is recorded/i);
    assert.doesNotMatch(payload.say, /team|someone|developer|specialist/i);
  }));

test("Riley returns the same server-recorded stage meter as the customer dashboard", () => {
  const now = Date.now();
  return withStubbedJob({
    status: "running",
    result: {
      progress: {
        lane: "plan",
        attempt: 1,
        stages: [
          { stage: "reading_site", at: new Date(now - 12_000).toISOString() },
          { stage: "planning", at: new Date(now - 4_000).toISOString() },
        ],
      },
    },
    created_at: new Date(now - 20_000).toISOString(),
    updated_at: new Date(now - 4_000).toISOString(),
  }, async (handler) => {
    const payload = payloadOf((await callTool(handler, vapiEnvelope({ jobId: JOB }))).json);
    assert.equal(payload.meter.stage, "planning");
    assert.equal(payload.meter.stageWords, "Planning the change");
    assert.equal(payload.say, payload.meter.plainWords);
  });
});

test("a long-running job stops predicting a time", () =>
  withStubbedJob({
    status: "running",
    result: {},
    updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  }, async (handler) => {
    const payload = payloadOf((await callTool(handler, vapiEnvelope({ jobId: JOB }))).json);
    assert.doesNotMatch(payload.say, /another minute or two/);
    assert.match(payload.say, /taking longer|stalled|recorded/i);
    assert.doesNotMatch(payload.say, /team|someone/i);
    assert.equal(payload.meter.stalled, true);
  }));

test("a wrong secret is refused before lookup", () =>
  withStubbedJob({
    status: "done",
    result: {},
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const response = await callTool(
      handler,
      vapiEnvelope({ jobId: JOB }),
      { secret: "not-the-secret" },
    );
    assert.equal(response.status, 401);
  }));

test("an auth failure is logged with the route name — drift must be visible in logs", () => {
  // THE PROVEN REPEAT OFFENDER: production ran this route 0-for-3 on auth
  // (calls 7 ×2, call 11) with nothing in the logs to say so. The one
  // structured line names the route, so the next drifted/rotated status
  // secret is visible at deploy time, not only on a live call.
  const saved = {
    secret: process.env.VAPI_TOOL_SECRET,
    log: console.log,
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  return Promise.resolve((async () => {
    delete require.cache[HANDLER_PATH];
    delete require.cache[STATUS_CORE_PATH];
    delete require.cache[EDIT_CORE_PATH];
    const handler = require(HANDLER_PATH);
    const res = mockRes();
    await handler(
      { method: "POST", headers: { "x-vapi-secret": "drifted-secret" }, body: vapiEnvelope({ jobId: JOB }), query: {} },
      res,
    );
    assert.equal(res.statusCode, 401);
    const line = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.event === "riley_tool_call");
    assert.ok(line, "a 401 on the status route must emit the one structured line");
    assert.equal(line.tool, "site_edit_status");
    assert.equal(line.outcome, "unauthorized");
    assert.equal(line.status, 401);
    assert.ok(Number.isFinite(line.ms) && line.ms >= 0);
  })()).finally(() => {
    console.log = saved.log;
    delete require.cache[HANDLER_PATH];
    delete require.cache[STATUS_CORE_PATH];
    delete require.cache[EDIT_CORE_PATH];
    if (saved.secret === undefined) delete process.env.VAPI_TOOL_SECRET;
    else process.env.VAPI_TOOL_SECRET = saved.secret;
  });
});

test("a missing jobId remains a 400", () =>
  withStubbedJob({
    status: "done",
    result: {},
    updated_at: new Date().toISOString(),
  }, async (handler) => {
    const response = await callTool(handler, vapiEnvelope({}));
    assert.equal(response.status, 400);
  }));
