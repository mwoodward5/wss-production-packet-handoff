"use strict";
// Confirm-before-apply contract for api/vapi-tools/site-edit.js.
//
// The claim the proof email makes to a customer is "text or call Riley and
// watch your site change". The hazard that claim creates is a wrong-client
// match: Riley edits the live site of a business the caller never named, and
// the caller hears "all done". There is no undo from their side.
//
// CONTRACT CHANGED 2026-09-02 (the stateful confirm). The FIRST call stores the
// exact instruction server-side, bound to the site the server resolved
// (lib/riley-edit-state.js). The confirming call carries only the six-character
// code (+ client_ref) — the instruction is fetched from storage, never echoed
// by the model, because echoing a 266-character token and re-typing prose is
// what killed authorised edits as bad_signature on a real call. The voice door
// mints NO token and accepts NONE: a token is the dashboard chat door's
// credential, where a browser copies bytes exactly.
const test = require("node:test");
const assert = require("node:assert/strict");

const targetsPath = require.resolve("../lib/site-edit-targets");
const storePath = require.resolve("../lib/store");
const statePath = require.resolve("../lib/riley-edit-state");
// The tool core binds the stubs below; it must reload with them, as the route shell does.
const corePath = require.resolve("../lib/site-edit-core");
const handlerPath = require.resolve("../api/vapi-tools/site-edit.js");

const SECRET = "test-secret-token-value-0123456789";
const SLUG = "wss-test-flint-plumbing-s5";
const BUSINESS = "Flint Plumbing LLC";
const DOMAIN = "wss-test-flint-plumbing-s5.wss-ai.com";
const INSTRUCTION = "Change the accent colour to a deep amber orange.";

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += chunk; return this; },
    write(chunk) { this.body += chunk; return true; },
  };
}

/**
 * Load the handler with the collaborators stubbed. `describe` lets a test
 * simulate "editable but unidentifiable". The state module is reloaded fresh
 * for every case, so pending instructions and trust never leak between tests.
 */
function withHandler(run, { describe = { site_slug: SLUG, business_name: BUSINESS, domain: DOMAIN, client_id: null, city: null, state: null, source: "site_metadata", target: { projectName: SLUG, aliasHost: DOMAIN } } } = {}) {
  const inserted = [];
  const events = [];
  const saved = {
    targets: require.cache[targetsPath],
    store: require.cache[storePath],
    state: require.cache[statePath],
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
      describeSiteEditTarget: async (slug) => (slug === SLUG ? describe : null),
    },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true, exports: {
      select: async () => ({ ok: false, data: [] }),
      insertRow: async (table, row) => { inserted.push({ table, row }); return { ok: true }; },
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
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

  return Promise.resolve(run({ call, inserted, events })).finally(() => {
    delete require.cache[handlerPath];
    delete require.cache[statePath];
    delete require.cache[corePath];
    delete require.cache[targetsPath];
    delete require.cache[storePath];
    if (saved.targets) require.cache[targetsPath] = saved.targets;
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.state) require.cache[statePath] = saved.state;
    if (saved.core) require.cache[corePath] = saved.core;
    if (saved.handler) require.cache[handlerPath] = saved.handler;
    global.fetch = saved.fetch;
    if (saved.secret === undefined) delete process.env.VAPI_TOOL_SECRET; else process.env.VAPI_TOOL_SECRET = saved.secret;
    if (saved.apiUrl === undefined) delete process.env.GHOST_AGENCY_API_URL; else process.env.GHOST_AGENCY_API_URL = saved.apiUrl;
  });
}

test("first call resolves business name and domain, speaks the name only, and queues nothing", () => withHandler(async ({ call, inserted }) => {
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "confirm_required");
  assert.equal(r.json.queued, false);
  assert.equal(r.json.jobId, undefined);
  assert.equal(r.json.confirm.business_name, BUSINESS);
  assert.equal(r.json.confirm.domain, DOMAIN);
  // The spoken line is the safety mechanism: the caller can only catch a wrong
  // match if the business is named out loud. It is named.
  assert.match(r.json.say, new RegExp(BUSINESS));
  // The DOMAIN must NOT be spoken. Riley read "wss-test-harris-air-west-
  // sacramento.wss-ai.com" to a caller who wanted his phone number enlarged;
  // the owner's note on call 019fd8d1 was "you don't have to double verify the
  // site URL and whatnot".
  assert.doesNotMatch(r.json.say, new RegExp(DOMAIN.replace(/\./g, "\\.")), "the domain must not be read aloud");
  // A dictated instruction already ends in a full stop; the template used to
  // append another, and a real run said "…make it bigger.. Yes?".
  assert.doesNotMatch(r.json.say, /\.\.\s/, "no doubled full stop before the question");
  assert.ok(r.json.confirm_code, "a confirmation code must be issued");
  assert.equal(inserted.length, 0, "nothing may be enqueued before confirmation");
}));

// --- THE TOKEN ECHO PATH IS DEAD --------------------------------------------
// Call 019fd8d1: the server minted a correct ~200-character confirm_token,
// Riley re-typed it from his own context and mangled the slug inside it twice,
// and an authorised edit died as bad_signature. The stateful confirm removes
// the echo entirely: no token is issued to the model, and carrying one earns
// nothing.

test("phase one never hands the model a token to echo", () => withHandler(async ({ call }) => {
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  assert.equal(r.json.confirm_token, undefined, "no opaque token may be issued to a voice model");
  assert.equal(r.json.next.includes("confirm_token"), false, "the instructions must not teach the echo");
}));

test("a confirm_token is not a credential on the voice door — only the code finalizes", () => withHandler(async ({ call, inserted }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  // A caller (or an old client) that shows up with nothing but a token is
  // answered the only honest way: a fresh read-back, and nothing enqueued.
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_token: `${first.json.confirm_code}.${"A".repeat(40)}` });
  assert.equal(r.json.queued, false, "a token may never enqueue an edit");
  assert.equal(inserted.length, 0);
  assert.equal(r.json.status, "confirm_required", "the response is a fresh phase one");
}));

// --- THE STATEFUL CONFIRM ----------------------------------------------------

test("the confirming call needs only the code — the instruction is fetched server-side", () => withHandler(async ({ call, inserted, events }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  // NO instruction on the finalize: the whole point of the stateful confirm.
  // What the model re-sent used to be the request; now what the server stored
  // is, so the model cannot mangle an authorised change between the halves.
  const r = await call({ siteSlug: SLUG, confirm_code: first.json.confirm_code });
  assert.equal(r.status, 200);
  assert.ok(r.json.jobId);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, "ghost_agency_edit_jobs");
  assert.equal(inserted[0].row.site_slug, SLUG);
  assert.equal(inserted[0].row.instruction, INSTRUCTION, "the enqueued instruction is the stored one");
  const queued = events.find((e) => e.name === "ghost_agency_site_edit_queued");
  assert.equal(queued.payload.confirmed, true);
  assert.equal(queued.payload.confirmed_business_name, BUSINESS);
  assert.equal(queued.payload.confirmed_domain, DOMAIN);
  assert.equal(queued.payload.credential, "confirm_code");
}));

test("the spoken code confirms the change the old token would have", () => withHandler(async ({ call, inserted, events }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: first.json.confirm_code });
  assert.equal(r.status, 200);
  assert.ok(r.json.jobId, "a correctly confirmed edit must enqueue");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].row.instruction, INSTRUCTION, "the stored words are enqueued even when the model re-sends its own");
  assert.equal(events.find((e) => e.name === "ghost_agency_site_edit_queued").payload.confirmed, true);
}));

test("a spoken code is read forgivingly — case and spacing do not matter", () => withHandler(async ({ call, inserted }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  const spoken = first.json.confirm_code.toLowerCase().split("").join(" ");
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: spoken });
  assert.equal(r.status, 200, "how a human dictates a code must not decide whether it works");
  assert.equal(inserted.length, 1);
}));

test("a guessed code is refused, with a usable replacement so the call never dead-ends", () => withHandler(async ({ call, inserted }) => {
  await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  for (const guess of ["ABCDEF", "234679", "", "TOOLONGCODE"]) {
    const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: guess });
    assert.ok(!r.json.jobId, `"${guess}" must not confirm an edit`);
    if (guess) assert.equal(r.json.reason, "confirm_code_invalid", `"${guess}" must be refused AS a bad code`);
    assert.ok(r.json.confirm_code, "every refusal carries a fresh, valid code for the change already read back");
  }
  assert.equal(inserted.length, 0);
  // The replacement code finalizes without a third round of asking the caller.
  const again = await call({ siteSlug: SLUG, instruction: INSTRUCTION, confirm_code: "WRONG1" });
  const done = await call({ siteSlug: SLUG, confirm_code: again.json.confirm_code });
  assert.equal(done.status, 200);
  assert.equal(inserted.length, 1);
}));

test("a code approved for one change cannot be spent on a different one — the second request waits its turn", () => withHandler(async ({ call, inserted }) => {
  const first = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  const r = await call({
    siteSlug: SLUG,
    instruction: "Delete the contact page and remove the phone number.",
    confirm_code: first.json.confirm_code,
  });
  // CONTRACT CHANGED 2026-09-02: a different instruction is no longer a
  // cryptic confirm_code_invalid — it is a NEW request made while one is
  // pending, and it is refused as exactly that (the silent-vanish guard),
  // with nothing enqueued and the pending change left standing.
  assert.equal(r.status, 409);
  assert.equal(r.json.status, "edit_pending");
  assert.equal(r.json.pending.instruction, INSTRUCTION, "the earlier change is still the one waiting");
  assert.equal(inserted.length, 0, "neither change may be enqueued");
  assert.match(r.json.next, /abandon_pending/, "the model must be told how to walk away from the first change");
}));

test("an editable-but-unidentifiable site is refused, not silently edited", () => withHandler(async ({ call, inserted }) => {
  const r = await call({ siteSlug: SLUG, instruction: INSTRUCTION });
  assert.equal(r.status, 409);
  assert.equal(r.json.status, "unidentifiable_site");
  assert.equal(inserted.length, 0);
  // The honest-lines law: no team to flag it to, no callback to promise.
  assert.doesNotMatch(r.json.say, /team|callback|call you back|escalat/i, "no invented machinery in the refusal");
}, { describe: null }));
