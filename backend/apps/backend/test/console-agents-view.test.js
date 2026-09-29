"use strict";

// Owner request 2026-08-06: bring the agents view back. It was removed in
// f0ac628 ("Port approved command center console").
//
// These tests pin the ONE property that makes the view worth having: it may
// only show what is true. The view it replaces failed exactly here — it drew a
// sweeping radar with a pulsing blip for every agent in the registry, while
// nine of those fourteen agents had never emitted a single event in the
// system's lifetime. An idle agent rendered as a live one is the same failure
// as a spinner over a dead build.

const test = require("node:test");
const assert = require("node:assert/strict");
const page = require("../lib/console-page");

test("the agents tab exists and loads lazily, without a second poll loop", () => {
  assert.match(page, /data-tabid="agents"/);
  assert.match(page, /id="tabPanelAgents"/);
  assert.match(page, /TAB_IDS=\["command","agents","operations","line"\]/);
  assert.match(page, /if\(id==="agents"\)loadAgentsTab\(\);/);
  // One fetch on open, exactly like the Operations and Line tabs.
  assert.match(page, /api\("\/api\/admin\/console-data\?view=agents"\)/);
  // console-operability.test.js pins the interval total; restate the intent
  // here so a future edit to this panel cannot quietly add its own timer.
  // (Arcade integration 2026-09-03: the hero's three visible-only feeds bring
  // the total to 4 — see console-arcade-hero.test.js.)
  assert.equal((page.match(/window\.setInterval\(/g) || []).length, 4);
  assert.doesNotMatch(page, /setInterval\([^)]*loadAgentsTab/);
});

test("the retired command bridge's animated radar does not come back", () => {
  // The same identifiers console-agents-visual.test.js retires. Restated here
  // because THIS is the file a future agent panel would be built in.
  for (const retired of [
    /Agent command bridge/i,
    /Voice provider registry/i,
    /agentVisualState/,
    /agentStatusWord/,
    /id="agentRadarBlips"/,
    /data-agent-state=/,
    /agentRadar\b/,
    /agentSweep/,
    /agentBlip/,
  ]) {
    assert.doesNotMatch(page, retired);
  }
});

test("only a server-measured ACTIVE agent is allowed to animate", () => {
  // The dot animation is attached to exactly one state class, and that class
  // is set from the server's state string — never from a client-side guess.
  assert.match(page, /\.st-active::before\{animation:beat/);
  for (const still of [".st-recent", ".st-dormant", ".st-never", ".st-unknown"]) {
    const rule = new RegExp(`\\${still}\\{[^}]*\\}`);
    const declaration = page.match(rule);
    assert.ok(declaration, `expected a rule for ${still}`);
    assert.doesNotMatch(declaration[0], /animation/);
  }
  // Reduced-motion users get no exception carved out for this panel.
  assert.match(page, /@media \(prefers-reduced-motion:reduce\)\{\.st-active::before\{animation:none\}\}/);
});

test("dormant and never-run agents are labelled in words, not just colour", () => {
  // Colour alone is not a label. The state word is rendered from the server's
  // own label field, and the roster says plainly when nothing has ever run.
  assert.match(page, /stateChip\(a\.state,a\.label\)/);
  assert.match(page, /no event on record, ever/);
  assert.match(page, /never taken a call/);
  assert.match(page, /is-never/);
  assert.match(page, /\.crew-row\.is-never\{opacity:/);
});

test("call rows report the real outcome of an edit, including refusal", () => {
  // The owner's question is "did the change actually land". applied / refused /
  // queued must each be renderable and visually distinct.
  assert.match(page, /out==="applied"\?"applied"/);
  assert.match(page, /\.ask\.refused\{/);
  assert.match(page, /\.ask\.applied\{/);
  assert.match(page, /\.ask\.queued\{/);
  // A call that resolved nobody says so rather than rendering an empty slot.
  assert.match(page, /Riley did not resolve this caller to an account/);
  // A provider outage must not read as "no calls today".
  assert.match(page, /Call history could not be read/);
});

test("a voice-provider outage is never rendered as an empty, healthy roster", () => {
  // "Nothing is provisioned" and "we could not ask" are different facts, and
  // only one of them is good news. Both strings must exist and be reachable
  // from the configured flag the server sets.
  assert.match(page, /Voice roster could not be read/);
  assert.match(page, /No voice assistants are provisioned/);
  assert.match(page, /renderCrew\(crew,!\(d\.voice&&d\.voice\.configured===false\)/);
});

test("the agents panel never invents its own liveness verdict", () => {
  // Every state class comes from the payload; the page has no local clock
  // arithmetic deciding whether an agent counts as running.
  assert.doesNotMatch(page, /function agentLiveness/);
  assert.match(page, /var known=\{active:1,recent:1,dormant:1,never:1,unknown:1\};/);
  assert.match(page, /var cls=known\[state\]\?state:"unknown";/);
});

// ---- data layer -----------------------------------------------------------

const handlerPath = require.resolve("../api/admin/console-data");

function loadWithStubs({ authOk = true } = {}) {
  const httpPath = require.resolve("../lib/http");
  const authPath = require.resolve("../lib/admin-auth");
  const previous = new Map([[httpPath, require.cache[httpPath]], [authPath, require.cache[authPath]], [handlerPath, require.cache[handlerPath]]]);
  const captured = {};
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireAdmin: () => authOk } };
  require.cache[httpPath] = {
    id: httpPath, filename: httpPath, loaded: true,
    exports: {
      methodGuard: () => true,
      sendJson: (_res, status, body) => { captured.status = status; captured.body = body; },
      handleError: (_res, error) => { captured.status = error.statusCode || 500; captured.body = { message: error.message }; },
    },
  };
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  return {
    handler,
    captured,
    restore() {
      for (const [key, value] of previous) {
        if (value) require.cache[key] = value;
        else delete require.cache[key];
      }
    },
  };
}

test("the agents view is a separate branch that never runs the snapshot load", async () => {
  // If this branch fell through to the snapshot it would inherit the poll's
  // read budget and its 2-day agent window — the window that cannot tell
  // "ran last week" from "never ran".
  const stubs = loadWithStubs();
  const storePath = require.resolve("../lib/store");
  const previousStore = require.cache[storePath];
  const seen = [];
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
      selectRows: async (table) => { seen.push(`selectRows:${table}`); return { mode: "live_select", rows: [] }; },
      select: async (table, query) => { seen.push(`select:${table}${query}`); return { ok: true, mode: "live_select", data: [] }; },
    },
  };
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  const previousKey = process.env.VAPI_API_KEY;
  delete process.env.VAPI_API_KEY;
  try {
    await handler({ method: "GET", url: "/api/admin/console-data?view=agents" }, {});
    assert.equal(stubs.captured.status, 200);
    assert.equal(stubs.captured.body.view, "agents");
    // The snapshot's own tables are never touched on this path.
    assert.equal(seen.filter((call) => call.startsWith("selectRows:")).length, 0);
    // Liveness is asked per actor, so "never" is a measured claim.
    const perActor = seen.filter((call) => /actor=eq\.agent_/.test(call));
    assert.equal(perActor.length, 14);
    assert.ok(perActor.every((call) => /order=created_at\.desc&limit=1/.test(call)));
  } finally {
    if (previousKey === undefined) delete process.env.VAPI_API_KEY;
    else process.env.VAPI_API_KEY = previousKey;
    if (previousStore) require.cache[storePath] = previousStore;
    else delete require.cache[storePath];
    stubs.restore();
  }
});

test("with no events and no voice provider, every agent reads as never run and nothing claims to be live", async () => {
  const stubs = loadWithStubs();
  const storePath = require.resolve("../lib/store");
  const previousStore = require.cache[storePath];
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
      selectRows: async () => ({ mode: "live_select", rows: [] }),
      select: async () => ({ ok: true, mode: "live_select", data: [] }),
    },
  };
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  const previousKey = process.env.VAPI_API_KEY;
  delete process.env.VAPI_API_KEY;
  try {
    await handler({ method: "GET", url: "/x?view=agents" }, {});
    const body = stubs.captured.body;
    assert.equal(body.pipeline.agents.length, 14);
    assert.ok(body.pipeline.agents.every((agent) => agent.state === "never" && agent.lastRun === null));
    assert.equal(body.pipeline.agents.filter((agent) => agent.state === "active").length, 0);
    // An unconfigured provider is reported as unavailable, never as "no calls".
    assert.equal(body.callsAvailable, false);
    assert.match(body.callsReason, /VAPI_API_KEY not configured/);
    assert.deepEqual(body.calls, []);
    assert.equal(body.voice.configured, false);
  } finally {
    if (previousKey === undefined) delete process.env.VAPI_API_KEY;
    else process.env.VAPI_API_KEY = previousKey;
    if (previousStore) require.cache[storePath] = previousStore;
    else delete require.cache[storePath];
    stubs.restore();
  }
});

test("a request with no view parameter is still the ordinary snapshot", async () => {
  // The perf harness calls the handler with a bare {method:"GET"} — no url, no
  // query. Reading the view must never throw on that shape.
  const stubs = loadWithStubs();
  const storePath = require.resolve("../lib/store");
  const previousStore = require.cache[storePath];
  let snapshotAttempted = false;
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
      selectRows: async () => { snapshotAttempted = true; return { mode: "live_select", rows: [] }; },
      select: async () => ({ ok: true, mode: "live_select", data: [] }),
    },
  };
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  try {
    await handler({ method: "GET" }, {});
    assert.equal(snapshotAttempted, true, "a view-less request must take the snapshot path");
    assert.equal(stubs.captured.body.view, undefined);
  } finally {
    if (previousStore) require.cache[storePath] = previousStore;
    else delete require.cache[storePath];
    stubs.restore();
  }
});
