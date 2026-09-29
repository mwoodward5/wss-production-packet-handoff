"use strict";
// test/riley-site-edit-fast-ack.test.js
//
// "call ended due to exceeding maximum duration while the AI was processing
//  the requested website change."
//
// That sentence — and its cousins "timed out due to silence" and "call ended
// while they waited" — is what the production Agents & Calls tab showed, over
// and over, across five businesses on 2026-08-17. Larson AC called three times
// to get ONE change through. Poor John's Plumbing waited on hold until the
// line died. In every one of those calls the customer had already said YES:
// the edit was confirmed, the work was running, and the call burned to death
// anyway because the tool call sat holding its breath while the rebuild ran.
//
// This file pins the contract that came out of it. A confirmed edit answers
// IMMEDIATELY — the rebuild is kicked, never awaited — and the sentence Riley
// speaks promises only what the system keeps: he will check, on this call or
// the next. No duration, no email, no text message; the customer-facing send
// rail is owner-only and no SMS provider exists, so a fast-ack that promised
// one would be the fabricated promise this whole path spent a year eradicating.
//
// The stubs mirror test/riley-site-edit-confirm.test.js, with one addition:
// lib/edit-job-runner is replaced by a runner that NEVER SETTLES. If the
// handler ever goes back to awaiting the build, the test does not time out
// with a stack trace — it fails with the story below, because a tool call
// that outlives Vapi's patience is exactly the death these calls died.

const test = require("node:test");
const assert = require("node:assert/strict");

const targetsPath = require.resolve("../lib/site-edit-targets");
const storePath = require.resolve("../lib/store");
const statePath = require.resolve("../lib/riley-edit-state");
const runnerPath = require.resolve("../lib/edit-job-runner");
// The tool core binds the stubs below; it must reload with them, as the route shell does.
const corePath = require.resolve("../lib/site-edit-core");
const handlerPath = require.resolve("../api/vapi-tools/site-edit.js");

const SECRET = "fast-ack-test-secret-0123456789";
const SLUG = "wss-test-larson-ac-fast-ack";
const BUSINESS = "Larson AC";
const DOMAIN = "wss-test-larson-ac-fast-ack.wss-ai.com";
const INSTRUCTION = "Make the logo bigger so it fills the header.";

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += String(chunk); return this; },
    write(chunk) { this.body += chunk; return true; },
  };
}

/**
 * The never-settling runner. `started` records that the kick happened at all;
 * the returned promise deliberately has no resolution path.
 */
function withFastAckHandler(fn) {
  const kicks = [];
  const saved = {
    targets: require.cache[targetsPath],
    store: require.cache[storePath],
    state: require.cache[statePath],
    runner: require.cache[runnerPath],
    core: require.cache[corePath],
    handler: require.cache[handlerPath],
    fetch: global.fetch,
    secret: process.env.VAPI_TOOL_SECRET,
    apiUrl: process.env.GHOST_AGENCY_API_URL,
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  process.env.GHOST_AGENCY_API_URL = "http://127.0.0.1:9";
  global.fetch = async () => ({ ok: true, json: async () => ({}) });

  require.cache[targetsPath] = {
    id: targetsPath, filename: targetsPath, loaded: true, exports: {
      resolveSiteEditTarget: async (slug) => (slug === SLUG ? { projectName: SLUG, aliasHost: DOMAIN } : null),
      resolveSiteEditTargetForCaller: async () => ({ status: "not_found", target: null, say: "" }),
      describeSiteEditTarget: async (slug) => (slug === SLUG
        ? { site_slug: SLUG, business_name: BUSINESS, domain: DOMAIN, client_id: null, city: null, state: null, source: "site_metadata", target: { projectName: SLUG, aliasHost: DOMAIN } }
        : null),
    },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true, exports: {
      select: async () => ({ ok: false, data: [] }),
      insertRow: async () => ({ ok: true }),
      recordEvent: async () => ({ ok: true }),
    },
  };
  require.cache[runnerPath] = {
    id: runnerPath, filename: runnerPath, loaded: true, exports: {
      // A build that never finishes. If the handler awaits this, the call is
      // dead — which is the failure this file exists to make impossible.
      executeEditJob: (jobId) => { kicks.push(jobId); return new Promise(() => {}); },
    },
  };
  delete require.cache[statePath];
  delete require.cache[corePath];
  delete require.cache[handlerPath];
  const handler = require(handlerPath);

  const call = async (args) => {
    const res = mockRes();
    await handler({ method: "POST", headers: { "x-vapi-secret": SECRET }, body: args, query: {} }, res);
    return { status: res.statusCode, json: JSON.parse(res.body) };
  };

  return Promise.resolve(fn({ call, kicks })).finally(() => {
    delete require.cache[handlerPath];
    delete require.cache[statePath];
    delete require.cache[corePath];
    delete require.cache[targetsPath];
    delete require.cache[storePath];
    delete require.cache[runnerPath];
    if (saved.targets) require.cache[targetsPath] = saved.targets;
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.state) require.cache[statePath] = saved.state;
    if (saved.core) require.cache[corePath] = saved.core;
    if (saved.runner) require.cache[runnerPath] = saved.runner;
    if (saved.handler) require.cache[handlerPath] = saved.handler;
    global.fetch = saved.fetch;
    if (saved.secret === undefined) delete process.env.VAPI_TOOL_SECRET; else process.env.VAPI_TOOL_SECRET = saved.secret;
    if (saved.apiUrl === undefined) delete process.env.GHOST_AGENCY_API_URL; else process.env.GHOST_AGENCY_API_URL = saved.apiUrl;
  });
}

/** The same forecast detector test/riley-never-promises-a-duration.test.js
 *  uses — quoted here so the fast-ack sentence is held to the century's law,
 *  not just the old branches'. */
const FORECAST = /\b(?:about|around|roughly|just|in|give (?:me|it)|another)\s+(?:a|an|one|two|a couple of|a few)?\s*(?:second|minute|hour)s?\b|\b(?:a|one|two|a couple of|a few)\s+(?:second|minute|hour)s?\b|\b(?:shortly|momentarily|any (?:second|minute) now)\b/i;

test("a confirmed edit answers WITHOUT waiting for the build — even one that never finishes", () => withFastAckHandler(async ({ call, kicks }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  assert.equal(first.json.status, "confirm_required");

  // The runner behind phase 2 NEVER settles. If the handler still awaited the
  // rebuild, this await would hang until the test runner gave up — the same
  // death the calls died, in miniature. Fast-ack means it cannot.
  const started = Date.now();
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: first.json.confirm_code });
  const waitedMs = Date.now() - started;

  assert.equal(r.status, 200);
  assert.ok(r.json.jobId, "the caller must be handed a jobId to ask about later");
  assert.equal(r.json.status, "queued");
  assert.equal(r.json.queued, true);
  assert.equal(r.json.applied, false, "nothing may be claimed as applied at ack time");
  // Answered in HTTP time, not build time. 5s is generous — the point is that
  // it is seconds away from the 20s Vapi kill and the ~10.5s simple build.
  assert.ok(waitedMs < 5_000, `the tool held the call for ${waitedMs}ms — the build must be kicked, not awaited`);

  // The kick happened: the job is running detached, and the sweeper owns its
  // durability if this lambda freezes. Not awaited is NOT not started.
  assert.deepEqual(kicks, [r.json.jobId]);
}));

test("the fast-ack sentence promises a check, never a duration, an email or a text", () => withFastAckHandler(async ({ call }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: first.json.confirm_code });
  const say = String(r.json.say);

  // The whole point of the fast-ack: the caller is TOLD the change is in, and
  // offered the two things that are real — Riley checking now, or a call back.
  assert.match(say, /building now/i);
  assert.match(say, /stay on the line|call back/i);
  // And nothing the system cannot keep. No duration has been measured for this
  // job; the customer send rail is owner-only; there is no SMS provider.
  assert.ok(!FORECAST.test(say), `the fast-ack sentence forecasts a duration: "${say}"`);
  assert.doesNotMatch(say, /\bemail\b|\btext\b|\btexted\b|\bsms\b/i);
  assert.doesNotMatch(say, /minute|second|hour/i);
  // The business is not named a fourth time — the caller agreed to it once.
  assert.doesNotMatch(say, new RegExp(BUSINESS));
}));

test("the fast-ack points Riley at site_edit_status as the only way to narrate progress", () => withFastAckHandler(async ({ call }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: first.json.confirm_code });
  assert.match(r.json.next, /site_edit_status/);
  assert.match(r.json.next, /jobId/);
  // And it forbids the two behaviours that killed the 2026-08-17 calls:
  // re-sending the same request, and inventing a time.
  assert.match(r.json.next, /do not re-send|not run this tool again/i);
  assert.match(r.json.next, /NEVER put a time on it/i);
}));

test("no terminal state is invented at ack time — done, refused and failed belong to the status tool", () => withFastAckHandler(async ({ call }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: first.json.confirm_code });
  // The ack knows exactly one thing: it is queued. Claiming anything about the
  // outcome before the runner reports one is the "it's live" lie in miniature.
  assert.equal(r.json.status, "queued");
  assert.equal(r.json.result, undefined);
  assert.equal(r.json.refused, undefined);
  assert.equal(r.json.failed, undefined);
}));
