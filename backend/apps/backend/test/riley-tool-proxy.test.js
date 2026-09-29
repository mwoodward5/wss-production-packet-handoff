"use strict";

// test/riley-tool-proxy.test.js — the contract for api/vapi-tools/riley.js,
// the ONE authenticated door for Riley's voice tools.
//
// The failure this file pins shut: each Vapi tool used to authenticate against
// its own route with its own copy of the secret check, and a deploy/rotation
// drift left one live call with lookup OK and site-edit-status 401 — five of
// seventeen tool calls lost while a customer listened. The proxy must:
//
//   · authenticate ONCE, against the one secret family, and fail closed;
//   · resolve which sub-tool the assistant invoked FROM THE PAYLOAD;
//   · dispatch to the tool cores as library functions (no HTTP hop), passing
//     each core's status and payload through untouched;
//   · emit exactly one structured log line per proxied call, env-gated;
//   · never let a wrong or missing secret reach any core.

const test = require("node:test");
const assert = require("node:assert/strict");

const PROXY_PATH = require.resolve("../api/vapi-tools/riley.js");
const CORE_PATHS = {
  lookup_business_record: require.resolve("../lib/riley-lookup-core"),
  look_up_customer: require.resolve("../lib/riley-context-core"),
  request_site_change: require.resolve("../lib/site-edit-core"),
  site_edit_status: require.resolve("../lib/edit-status-core"),
  send_note: require.resolve("../lib/riley-send-note-core"),
};
const CORE_EXPORTS = {
  lookup_business_record: "lookupProspectCore",
  look_up_customer: "rileyContextCore",
  request_site_change: "siteEditCore",
  site_edit_status: "siteEditStatusCore",
  send_note: "sendNoteCore",
};
const STORE_PATH = require.resolve("../lib/store");
const PROGRESS_PATH = require.resolve("../lib/edit-progress");
const STATUS_CORE_PATH = CORE_PATHS.site_edit_status;

const SECRET = "riley-proxy-test-secret-0123456789";

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk !== undefined) this.body += String(chunk); return this; },
  };
}

function vapiBody(name, args, { id = "toolcall_1" } = {}) {
  return {
    message: {
      type: "tool-calls",
      toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
      call: { id: "call_test" },
    },
  };
}

/**
 * Load the proxy with each tool core replaced by a recorder, so the tests
 * assert on DISPATCH (which core, given what body) rather than re-test what
 * the cores' own suites already pin.
 */
function withProxy(run, { env = {} } = {}) {
  const calls = []; // { tool, body }
  const saved = {
    proxy: require.cache[PROXY_PATH],
    cores: Object.fromEntries(Object.entries(CORE_PATHS).map(([k, p]) => [k, require.cache[p]])),
    secret: process.env.VAPI_TOOL_SECRET,
    webhook: process.env.VAPI_WEBHOOK_SECRET,
    admin: process.env.GHOST_AGENCY_ADMIN_TOKEN,
    telemetry: process.env.GHOST_AGENCY_RILEY_TELEMETRY,
    log: console.log,
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  delete process.env.GHOST_AGENCY_RILEY_TELEMETRY;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  const lines = [];
  console.log = (...args) => { lines.push(args.join(" ")); };

  for (const [tool, path] of Object.entries(CORE_PATHS)) {
    require.cache[path] = {
      id: path, filename: path, loaded: true,
      exports: {
        [CORE_EXPORTS[tool]]: async (body) => {
          calls.push({ tool, body });
          return { status: 200, payload: { dispatched: tool, sawBody: body === undefined ? null : true } };
        },
      },
    };
  }
  delete require.cache[PROXY_PATH];
  const handler = require(PROXY_PATH);

  const call = async (body, { headers = { "x-vapi-secret": SECRET }, method = "POST" } = {}) => {
    const res = mockRes();
    await handler({ method, headers, body, query: {} }, res);
    let json = null;
    try { json = JSON.parse(res.body); } catch { /* leave null */ }
    return { status: res.statusCode, json, raw: res.body, lines };
  };

  return Promise.resolve(run({ handler, call, calls, lines })).finally(() => {
    console.log = saved.log;
    delete require.cache[PROXY_PATH];
    for (const p of Object.values(CORE_PATHS)) delete require.cache[p];
    if (saved.proxy) require.cache[PROXY_PATH] = saved.proxy;
    for (const [k, rec] of Object.entries(saved.cores)) if (rec) require.cache[CORE_PATHS[k]] = rec;
    if (saved.secret === undefined) delete process.env.VAPI_TOOL_SECRET; else process.env.VAPI_TOOL_SECRET = saved.secret;
    if (saved.webhook === undefined) delete process.env.VAPI_WEBHOOK_SECRET; else process.env.VAPI_WEBHOOK_SECRET = saved.webhook;
    if (saved.admin === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN; else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved.admin;
    if (saved.telemetry === undefined) delete process.env.GHOST_AGENCY_RILEY_TELEMETRY; else process.env.GHOST_AGENCY_RILEY_TELEMETRY = saved.telemetry;
  });
}

// ---------------------------------------------------------------------------
// 1. AUTH ONCE, FAIL CLOSED
// ---------------------------------------------------------------------------

test("a wrong secret is a bare 401 and reaches NO core", () => withProxy(async ({ call, calls }) => {
  const r = await call(vapiBody("lookup_business_record", { business_name: "x" }), { headers: { "x-vapi-secret": "not-the-secret" } });
  assert.equal(r.status, 401);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, "unauthorized");
  assert.deepEqual(calls, [], "no sub-tool may run for an unauthenticated call");
}));

test("a missing secret header is a 401, and so is a proxy with no secret configured", () => withProxy(async ({ handler, call, calls }) => {
  const r = await call(vapiBody("lookup_business_record", {}), { headers: {} });
  assert.equal(r.status, 401);
  assert.deepEqual(calls, []);

  // The check fails closed: with NO secret configured at all, even a guessed
  // header authenticates nobody.
  delete process.env.VAPI_TOOL_SECRET;
  const res = mockRes();
  await handler({ method: "POST", headers: { "x-vapi-secret": "anything" }, body: vapiBody("lookup_business_record", {}), query: {} }, res);
  assert.equal(res.statusCode, 401);
}));

test("the one secret is accepted in every header form any old route took", () => withProxy(async ({ call, calls }) => {
  for (const headers of [
    { "x-vapi-secret": SECRET },
    { "x-admin-token": SECRET },
    { authorization: `Bearer ${SECRET}` },
  ]) {
    calls.length = 0;
    const r = await call(vapiBody("site_edit_status", { jobId: "j" }), { headers });
    assert.equal(r.status, 200, `header ${Object.keys(headers)[0]} must authenticate`);
    assert.equal(calls.length, 1);
  }
}));

// ---------------------------------------------------------------------------
// 2. RESOLVE THE SUB-TOOL FROM THE PAYLOAD, DISPATCH AS A LIBRARY CALL
// ---------------------------------------------------------------------------

test("each Vapi function name dispatches to ITS core with the original body", () => withProxy(async ({ call, calls }) => {
  const expectations = {
    lookup_business_record: { business_name: "RiverCity Plumbing" },
    look_up_customer: { client_ref: "WSS-1F9506" },
    request_site_change: { client_ref: "WSS-1F9506", instruction: "make the logo bigger" },
    site_edit_status: { jobId: "edit_123" },
    send_note: { to: "woodwardsoftware@gmail.com", subject: "hi", body: "note" },
  };
  for (const [name, args] of Object.entries(expectations)) {
    calls.length = 0;
    const body = vapiBody(name, args);
    const r = await call(body);
    assert.equal(r.status, 200, name);
    assert.equal(calls.length, 1, `${name}: exactly one core dispatch`);
    assert.equal(calls[0].tool, name, `${name}: the RIGHT core, not a sibling`);
    assert.deepEqual(calls[0].body, JSON.parse(JSON.stringify(body)), `${name}: the core gets the original wrapped body, not a re-shape`);
    assert.deepEqual(r.json, { dispatched: name, sawBody: true }, `${name}: status and payload pass through untouched`);
  }
}));

test("a non-Vapi probe can name the tool directly, the riley-tools.js shape", () => withProxy(async ({ call, calls }) => {
  const r = await call({ tool: "send_note", to: "woodwardsoftware@gmail.com" });
  assert.equal(r.status, 200);
  assert.equal(calls[0].tool, "send_note");
}));

test("an unknown tool is a 400 that names the known tools, with no dispatch", () => withProxy(async ({ call, calls }) => {
  const r = await call(vapiBody("transfer_to_team", {}));
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
  assert.match(r.json.error, /unknown tool transfer_to_team/);
  assert.deepEqual([...r.json.tools].sort(), ["generate_poster", "look_up_customer", "lookup_business_record", "request_site_change", "send_note", "site_edit_status"]);
  assert.deepEqual(calls, []);
}));

test("non-POST methods never reach a core", () => withProxy(async ({ handler, calls }) => {
  const res = mockRes();
  await handler({ method: "GET", headers: { "x-vapi-secret": SECRET }, body: vapiBody("send_note", {}), query: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.deepEqual(calls, []);
}));

// ---------------------------------------------------------------------------
// 3. ONE STRUCTURED LOG LINE PER PROXIED CALL
// ---------------------------------------------------------------------------

test("every proxied call emits exactly one line naming tool, outcome and ms", () => withProxy(async ({ call, lines }) => {
  lines.length = 0;
  await call(vapiBody("site_edit_status", { jobId: "j" }));
  const emitted = lines.filter((l) => l.includes("riley_tool_call"));
  assert.equal(emitted.length, 1);
  const line = JSON.parse(emitted[0]);
  assert.equal(line.event, "riley_tool_call");
  assert.equal(line.tool, "site_edit_status");
  assert.equal(line.outcome, "ok");
  assert.equal(line.status, 200);
  assert.ok(Number.isFinite(line.ms) && line.ms >= 0);
  assert.ok(line.at, "the line carries its timestamp");
  assert.ok(!/secret/i.test(JSON.stringify(line)), "the line never names a secret");
}));

test("an auth failure is logged WITH THE TOOL NAME, so drift names the route", () => withProxy(async ({ handler, call, lines }) => {
  // The production failure was site_edit_status 401ing while its siblings
  // answered; a 401 logged as "(none)" would have hidden exactly that. The
  // proxy reads the body before the auth decision precisely so the line can
  // name the denied tool.
  const res = mockRes();
  await handler({ method: "POST", headers: { "x-vapi-secret": "wrong" }, body: vapiBody("site_edit_status", { jobId: "j" }), query: {} }, res);
  assert.equal(res.statusCode, 401);
  const unauthorized = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.event === "riley_tool_call");
  assert.equal(unauthorized.tool, "site_edit_status", "the 401 line must name the denied tool");
  assert.equal(unauthorized.outcome, "unauthorized");
  assert.equal(unauthorized.status, 401);

  // ...and for a direct probe body that names its tool the same way.
  lines.length = 0;
  await handler({ method: "POST", headers: { "x-admin-token": "wrong" }, body: { tool: "send_note", to: "x" }, query: {} }, mockRes());
  const named = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.event === "riley_tool_call");
  assert.equal(named.tool, "send_note");

  // An empty body still authenticates nobody and stays unnamed — the header
  // decides nothing about the name; the payload does.
  lines.length = 0;
  const r2 = await call({}, { headers: {} });
  assert.equal(r2.status, 401);
  const none = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.event === "riley_tool_call");
  assert.equal(none.tool, "(none)");
}));

test("unknown-tool calls are logged with their outcomes too", () => withProxy(async ({ call, lines }) => {
  lines.length = 0;
  await call(vapiBody("no_such_tool", {}));
  const unknown = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((j) => j && j.event === "riley_tool_call");
  assert.equal(unknown.outcome, "unknown_tool");
  assert.equal(unknown.status, 400);
}));

// ---------------------------------------------------------------------------
// 4. THE REAL CORES BEHIND THE PROXY (no core stubs: real auth, real dispatch)
// ---------------------------------------------------------------------------

test("the proxy drives the REAL status core: right secret dispatches, wrong secret is a bare 401", () => {
  const saved = {
    proxy: require.cache[PROXY_PATH],
    store: require.cache[STORE_PATH],
    progress: require.cache[PROGRESS_PATH],
    statusCore: require.cache[STATUS_CORE_PATH],
    secret: process.env.VAPI_TOOL_SECRET,
    webhook: process.env.VAPI_WEBHOOK_SECRET,
    admin: process.env.GHOST_AGENCY_ADMIN_TOKEN,
    log: console.log,
  };
  console.log = () => {};
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;

  const selects = [];
  require.cache[STORE_PATH] = {
    id: STORE_PATH, filename: STORE_PATH, loaded: true,
    exports: { select: async (table, q) => { selects.push({ table, q }); return { ok: true, data: [] }; } },
  };
  require.cache[PROGRESS_PATH] = {
    id: PROGRESS_PATH, filename: PROGRESS_PATH, loaded: true,
    exports: { describeEditProgress: async () => null, flagStalledEditJob: async () => ({}) },
  };
  delete require.cache[STATUS_CORE_PATH];
  delete require.cache[PROXY_PATH];
  const handler = require(PROXY_PATH);

  return (async () => {
    const wrong = mockRes();
    await handler({ method: "POST", headers: { "x-vapi-secret": "nope" }, body: vapiBody("site_edit_status", { jobId: "j1" }), query: {} }, wrong);
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(selects, [], "a wrong secret must not touch the store");

    const right = mockRes();
    await handler({ method: "POST", headers: { "x-vapi-secret": SECRET }, body: vapiBody("site_edit_status", { jobId: "j1" }), query: {} }, right);
    assert.equal(right.statusCode, 404, "the real status core answered through the proxy");
    const payload = JSON.parse(right.body);
    assert.equal(payload.error, "job not found");
    assert.equal(selects.length, 1);
    assert.match(selects[0].q, /j1/);
  })().finally(() => {
    delete require.cache[PROXY_PATH];
    delete require.cache[STATUS_CORE_PATH];
    if (saved.proxy) require.cache[PROXY_PATH] = saved.proxy;
    if (saved.store) require.cache[STORE_PATH] = saved.store;
    if (saved.progress) require.cache[PROGRESS_PATH] = saved.progress;
    if (saved.statusCore) require.cache[STATUS_CORE_PATH] = saved.statusCore;
    if (saved.secret === undefined) delete process.env.VAPI_TOOL_SECRET; else process.env.VAPI_TOOL_SECRET = saved.secret;
    if (saved.webhook === undefined) delete process.env.VAPI_WEBHOOK_SECRET; else process.env.VAPI_WEBHOOK_SECRET = saved.webhook;
    if (saved.admin === undefined) delete process.env.GHOST_AGENCY_ADMIN_TOKEN; else process.env.GHOST_AGENCY_ADMIN_TOKEN = saved.admin;
    console.log = saved.log;
  });
});

// ---------------------------------------------------------------------------
// 5. THE TELEMETRY GATE ITSELF (pure, line-telemetry.js style)
// ---------------------------------------------------------------------------

test("the telemetry gate: full by default, reduced keeps only non-2xx, off silences", () => {
  const { rileyTelemetryLevel, shouldLogRileyToolCall, rileyToolCallEvent, emitRileyToolCall } = require("../lib/riley-telemetry");
  const ok = { tool: "send_note", status: 200, outcome: "ok", ms: 12 };
  const drift = { tool: "site_edit_status", status: 401, outcome: "unauthorized", ms: 3 };

  assert.equal(rileyTelemetryLevel({}), "full");
  assert.equal(rileyTelemetryLevel({ GHOST_AGENCY_RILEY_TELEMETRY: "reduced" }), "reduced");
  assert.equal(rileyTelemetryLevel({ GHOST_AGENCY_RILEY_TELEMETRY: "off" }), "off");
  assert.equal(rileyTelemetryLevel({ GHOST_AGENCY_RILEY_TELEMETRY: "FULL" }), "full", "unrecognized values are full");

  assert.equal(shouldLogRileyToolCall({}, ok), true);
  assert.equal(shouldLogRileyToolCall({ GHOST_AGENCY_RILEY_TELEMETRY: "reduced" }, ok), false, "a clean dispatch is the volume reduced drops");
  assert.equal(shouldLogRileyToolCall({ GHOST_AGENCY_RILEY_TELEMETRY: "reduced" }, drift), true, "the 401 class is the whole point");
  assert.equal(shouldLogRileyToolCall({ GHOST_AGENCY_RILEY_TELEMETRY: "off" }, drift), false);

  const out = [];
  emitRileyToolCall({}, drift, (s) => out.push(s));
  assert.equal(out.length, 1);
  const line = JSON.parse(out[0]);
  assert.equal(line.event, "riley_tool_call");
  assert.equal(line.tool, "site_edit_status");
  assert.equal(line.outcome, "unauthorized");
  assert.equal(line.status, 401);
  assert.equal(line.ms, 3);

  const flat = JSON.stringify(rileyToolCallEvent(ok));
  assert.ok(!/\n/.test(flat), "one line");
  assert.ok(!/secret/i.test(flat), "never a secret in it");
});

test("reduced telemetry in the proxy: healthy calls are silent, the 401 is not", () => withProxy(async ({ handler, call, lines }) => {
  process.env.GHOST_AGENCY_RILEY_TELEMETRY = "reduced";
  const r = await call(vapiBody("lookup_business_record", { business_name: "x" }));
  assert.equal(r.status, 200);
  assert.equal(lines.filter((l) => l.includes("riley_tool_call")).length, 0, "a clean dispatch earns no line under reduced");

  const res = mockRes();
  await handler({ method: "POST", headers: { "x-vapi-secret": "wrong" }, body: vapiBody("lookup_business_record", {}), query: {} }, res);
  assert.equal(lines.filter((l) => l.includes("riley_tool_call")).length, 1, "the auth failure does");
}));
