"use strict";

// test/planner-ladder.test.js — the planner ladder and the executor's refusals.
//
// THE LADDER: claude-sonnet-5 -> claude-sonnet-4-5 -> gemini-2.5-flash, every
// fall recorded as a ghost_agency_planner_fallback event. The silent era —
// production's dead ANTHROPIC_API_KEY routing every customer edit to the
// cheapest model with nobody knowing — is the measured failure these tests pin
// against recurring.
//
// THE REFUSALS: an op the executor cannot apply must come back as a refusal
// carrying a sentence Riley can speak, never as a bare failed row.

const test = require("node:test");
const assert = require("node:assert/strict");

const P = require("../lib/site-change-plan");
const store = require("../lib/store");

const PLAN_TEXT = JSON.stringify({
  summary: "I will make the headline orange.",
  ops: [{ op: "style_override", target: "e1", declarations: "color: #ff6600;" }],
});

const anthropicOk = () => ({
  ok: true,
  json: async () => ({ content: [{ text: PLAN_TEXT }] }),
});
const anthropicError = (type, status = 400) => ({
  ok: false,
  status,
  json: async () => ({ error: { type, message: `${type} happened` } }),
});
const geminiOk = () => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text: PLAN_TEXT }] } }] }),
});

/** Capture ghost_agency_planner_fallback events without a live store. */
function captureEvents(fn) {
  const events = [];
  const original = store.recordEvent;
  store.recordEvent = (type, payload) => { events.push({ type, payload }); return Promise.resolve({ ok: true }); };
  const restore = () => { store.recordEvent = original; };
  return fn(events).finally(restore);
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  return fn().finally(restore);
}

test("rung 1 healthy: sonnet-5 plans, nothing falls, no event", () =>
  withEnv({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, () =>
    captureEvents(async (events) => {
      const calls = [];
      const out = await P.__planner("PROMPT", {
        fetchImpl: async (url, init) => { calls.push(JSON.parse(init.body)); return anthropicOk(); },
      });
      assert.equal(out, PLAN_TEXT);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, "claude-sonnet-5");
      // Sonnet 5 rejects non-default sampling params and thinks by default —
      // the body must carry thinking:disabled and no temperature.
      assert.deepEqual(calls[0].thinking, { type: "disabled" });
      assert.ok(!("temperature" in calls[0]), "temperature is a 400 on sonnet-5");
      assert.equal(P.lastPlannerFallback(), "");
      assert.equal(events.length, 0);
    })));

test("a non-auth sonnet-5 failure falls one rung, on the record, and sonnet-4-5 keeps its old body", () =>
  withEnv({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, () =>
    captureEvents(async (events) => {
      const calls = [];
      const out = await P.__planner("PROMPT", {
        fetchImpl: async (url, init) => {
          const body = JSON.parse(init.body);
          calls.push(body);
          return body.model === "claude-sonnet-5" ? anthropicError("not_found_error", 404) : anthropicOk();
        },
      });
      assert.equal(out, PLAN_TEXT);
      assert.deepEqual(calls.map((c) => c.model), ["claude-sonnet-5", "claude-sonnet-4-5"]);
      assert.equal(calls[1].temperature, 0, "the pre-5 rung keeps temperature 0 for determinism");
      assert.ok(!("thinking" in calls[1]));
      assert.equal(events.length, 1);
      assert.deepEqual(events[0], {
        type: "ghost_agency_planner_fallback",
        payload: { from: "claude-sonnet-5", to: "claude-sonnet-4-5", reason: "anthropic_error:not_found_error" },
      });
    })));

test("an auth failure skips the doomed second 401 and falls straight to gemini", () =>
  withEnv({ ANTHROPIC_API_KEY: "dead", GEMINI_API_KEY: "g" }, () =>
    captureEvents(async (events) => {
      const anthropicCalls = [];
      const out = await P.__planner("PROMPT", {
        fetchImpl: async (url, init) => {
          if (/api\.anthropic\.com/.test(url)) { anthropicCalls.push(JSON.parse(init.body).model); return anthropicError("authentication_error", 401); }
          return geminiOk();
        },
      });
      assert.equal(out, PLAN_TEXT);
      // The SAME key backs every Anthropic rung — one 401 is all of them.
      assert.deepEqual(anthropicCalls, ["claude-sonnet-5"]);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].payload, { from: "claude-sonnet-5", to: "gemini-2.5-flash", reason: "anthropic_auth_failed" });
      assert.equal(P.lastPlannerFallback(), "anthropic_auth_failed");
    })));

test("both anthropic rungs failing lands on gemini with BOTH falls recorded", () =>
  withEnv({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, () =>
    captureEvents(async (events) => {
      const out = await P.__planner("PROMPT", {
        fetchImpl: async (url) => (/api\.anthropic\.com/.test(url) ? anthropicError("overloaded_error", 529) : geminiOk()),
      });
      assert.equal(out, PLAN_TEXT);
      assert.deepEqual(events.map((e) => [e.payload.from, e.payload.to]), [
        ["claude-sonnet-5", "claude-sonnet-4-5"],
        ["claude-sonnet-4-5", "gemini-2.5-flash"],
      ]);
      for (const e of events) assert.equal(e.payload.reason, "anthropic_error:overloaded_error");
    })));

test("a transport death is a recorded fall, not a dead job", () =>
  withEnv({ ANTHROPIC_API_KEY: "k", GEMINI_API_KEY: "g" }, () =>
    captureEvents(async (events) => {
      const out = await P.__planner("PROMPT", {
        fetchImpl: async (url) => {
          if (/api\.anthropic\.com/.test(url)) throw new Error("socket hang up");
          return geminiOk();
        },
      });
      assert.equal(out, PLAN_TEXT);
      assert.equal(events.length, 2);
      assert.match(events[0].payload.reason, /^anthropic_unreachable:socket hang up/);
    })));

test("no anthropic key: the skip itself is on the record", () =>
  withEnv({ ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: "g" }, () =>
    captureEvents(async (events) => {
      const out = await P.__planner("PROMPT", { fetchImpl: async () => geminiOk() });
      assert.equal(out, PLAN_TEXT);
      assert.equal(events.length, 1);
      assert.deepEqual(events[0].payload, { from: "claude-sonnet-5", to: "gemini-2.5-flash", reason: "anthropic_key_unset" });
    })));

test("no planner configured at all still throws — a job with no model is a failure, not a refusal", () =>
  withEnv({ ANTHROPIC_API_KEY: undefined, GEMINI_API_KEY: undefined }, () =>
    captureEvents(async () => {
      await assert.rejects(() => P.__planner("PROMPT", { fetchImpl: async () => geminiOk() }), /no planner model configured/);
    })));

// ---------------------------------------------------------------------------
// The executor's refusals: a sentence, not a stack trace.
// ---------------------------------------------------------------------------
test("plainApplySay strips the op prefix and states that nothing changed", () => {
  const say = P.plainApplySay(new Error("insert_html: 'a9' is not one of this site's anchors"));
  assert.match(say, /^I couldn't make that change — 'a9' is not one of this site's anchors\./);
  assert.match(say, /Nothing on your site changed/);
  assert.ok(!/insert_html/.test(say), "the op name is developer vocabulary, not caller vocabulary");
});

test("plainApplySay caps a run-on reason so Riley's sentence stays speakable", () => {
  const say = P.plainApplySay(new Error(`style_override: ${"x".repeat(400)}`));
  assert.ok(say.length < 320, `say is ${say.length} chars`);
  assert.match(say, /…\. Nothing on your site changed/);
});

test("plainApplySay survives an error with no message", () => {
  const say = P.plainApplySay(null);
  assert.match(say, /^I couldn't make that change — /);
  assert.match(say, /Nothing on your site changed/);
});
