"use strict";

// test/riley-promise-tools.test.js — the safety contract for Riley's three
// promise tools (api/vapi-tools/flag-for-team.js, schedule-callback.js,
// record-opt-out.js).
//
// Every test drives the real HTTP handler with stubbed store / mailer /
// suppression lanes, exactly the way test/riley-send-note.test.js does. The
// load-bearing assertions are on the WRITES: a tool that says "done" without
// its durable row is the same phantom promise these tools exist to end.

const test = require("node:test");
const assert = require("node:assert/strict");

const SECRET = "vapi-tool-secret-for-tests-0123456789";
const OWNER = "woodwardsoftware@gmail.com";

const HANDLERS = {
  flag: require.resolve("../api/vapi-tools/flag-for-team.js"),
  callback: require.resolve("../api/vapi-tools/schedule-callback.js"),
  optout: require.resolve("../api/vapi-tools/record-opt-out.js"),
};
const storePath = require.resolve("../lib/store");
const emailPath = require.resolve("../lib/email");
const suppressionPath = require.resolve("../lib/contact-suppression");

function mockRes() {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(chunk) { if (chunk) this.body += chunk; return this; },
  };
}

/**
 * Load one tool handler with the store, mailer and suppression lanes stubbed.
 * `rows` seeds the store's select() for the tool's duplicate checks; every
 * stub reads the MUTABLE `state` object, and `call(options)` can update it per
 * invocation (rows / storeResult / suppressResult).
 */
function withTool(which, run, { rows = [], storeResult = { mode: "live_write" }, suppressResult } = {}) {
  const inserts = [];
  const selects = [];
  const events = [];
  const mails = [];
  const suppressions = [];
  const state = { rows, storeResult, suppressResult };
  const saved = {
    store: require.cache[storePath],
    email: require.cache[emailPath],
    suppression: require.cache[suppressionPath],
    handlers: Object.fromEntries(Object.values(HANDLERS).map((p) => [p, require.cache[p]])),
    env: {
      VAPI_TOOL_SECRET: process.env.VAPI_TOOL_SECRET,
      VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
      GHOST_AGENCY_ADMIN_TOKEN: process.env.GHOST_AGENCY_ADMIN_TOKEN,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      GHOST_AGENCY_OWNER_EMAIL: process.env.GHOST_AGENCY_OWNER_EMAIL,
    },
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER;

  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true,
    exports: {
      insertRow: async (table, row) => { inserts.push({ table, row }); return state.storeResult; },
      select: async (table, query) => { selects.push({ table, query }); return { ok: true, data: state.rows }; },
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
      upsertRow: async () => ({ mode: "live_upsert" }),
    },
  };
  require.cache[emailPath] = {
    id: emailPath, filename: emailPath, loaded: true,
    exports: { sendResendEmail: async (input) => { mails.push(input); return { mode: "sent", id: "re_test_1" }; } },
  };
  require.cache[suppressionPath] = {
    id: suppressionPath, filename: suppressionPath, loaded: true,
    exports: { suppressContact: async (input) => { suppressions.push(input); return state.suppressResult || {
      suppression: { mode: "live_upsert", table: "ghost_agency_suppressions" },
      consent: { mode: "live_upsert", table: "consent_registrar" },
      channels: input.channels,
    }; } },
  };
  delete require.cache[HANDLERS[which]];
  const handler = require(HANDLERS[which]);

  const call = async (args, { headers = { "x-vapi-secret": SECRET }, method = "POST", vapi = false, ...over } = {}) => {
    Object.assign(state, over); // per-call: rows, storeResult, suppressResult
    const body = vapi
      ? { message: { call: { id: "call-test-9" }, customer: { number: "+19165550000" }, toolCalls: [{ id: "tc_1", function: { name: which, arguments: args } }] } }
      : args;
    const res = mockRes();
    await handler({ method, headers, body, query: {} }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };

  return Promise.resolve(run({ call, inserts, selects, events, mails, suppressions })).finally(() => {
    delete require.cache[HANDLERS[which]];
    for (const [p, m] of Object.entries(saved.handlers)) if (m) require.cache[p] = m; else delete require.cache[p];
    if (saved.store) require.cache[storePath] = saved.store; else delete require.cache[storePath];
    if (saved.email) require.cache[emailPath] = saved.email; else delete require.cache[emailPath];
    if (saved.suppression) require.cache[suppressionPath] = saved.suppression; else delete require.cache[suppressionPath];
    for (const [k, v] of Object.entries(saved.env)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

// ===========================================================================
// auth — identical to every other tool in the directory
// ===========================================================================

for (const [label, which] of [["flag_for_team", "flag"], ["schedule_callback", "callback"], ["record_opt_out", "optout"]]) {
  test(`${label}: refuses unauthenticated and wrong-secret callers with 401`, () => withTool(which, async ({ call }) => {
    assert.equal((await call({}, { headers: {} })).status, 401, "no secret, no service");
    assert.equal((await call({}, { headers: { "x-vapi-secret": "wrong" } })).status, 401);
    assert.equal((await call({}, { headers: { "x-admin-token": "wrong" } })).status, 401);
  }));
}

// ===========================================================================
// flag_for_team — "I flagged it for the team" becomes a fact
// ===========================================================================

test("flag_for_team happy path: durable row, ledger event, owner email NOW, honest say", () => withTool("flag", async ({ call, inserts, events, mails }) => {
  const r = await call({ client_ref: "WSS-1F9506", reason: "Gallery photos look stretched on mobile", job_id: "edit_test_1", site_slug: "wss-test-logic-heating-and-air-tulsa" }, { vapi: true });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.flagged, true);
  assert.match(r.json.flag_id, /^flag_/);

  assert.equal(inserts.length, 1, "the flag is a durable row, not a sentence");
  assert.equal(inserts[0].table, "ghost_agency_team_flags");
  assert.equal(inserts[0].row.reason, "Gallery photos look stretched on mobile");
  assert.equal(inserts[0].row.client_ref, "WSS-1F9506");
  assert.equal(inserts[0].row.job_id, "edit_test_1");
  assert.equal(inserts[0].row.call_id, "call-test-9", "the call that raised it is on the row");
  assert.equal(inserts[0].row.status, "open");

  assert.ok(events.some((e) => e.name === "ghost_agency_team_flag_created"), "the ending is on the ledger too");
  assert.equal(mails.length, 1, "the owner gets it now — that is what makes the past tense honest");
  assert.equal(mails[0].to, OWNER);
  assert.match(mails[0].subject, /Team flag/);
  assert.match(mails[0].text, /Gallery photos look stretched on mobile/);

  // Vapi envelope: the result must be bound to its toolCallId.
  assert.equal(r.json.results[0].toolCallId, "tc_1");

  // Truth law: recorded + visible now, no ETA, no named teammate.
  assert.match(r.json.say, /flagged for the team/);
  assert.doesNotMatch(r.json.say, /minute|hour|today|shortly|soon|will (?:call|reach out)/i);
  assert.doesNotMatch(r.json.say, /Marcus|Ava|Jake|Sophie|Mia/i);
}));

test("flag_for_team: no reason, no row — and Riley asks for one instead of inventing it", () => withTool("flag", async ({ call, inserts, mails }) => {
  const r = await call({ client_ref: "WSS-1F9506" }, { vapi: true });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.refused, "reason_missing");
  assert.equal(inserts.length, 0);
  assert.equal(mails.length, 0);
  assert.match(r.json.say, /what the issue is/i);
}));

test("flag_for_team: a failed store write is admitted out loud, never claimed as flagged", () => withTool("flag", async ({ call, mails }) => {
  const r = await call({ reason: "contact form sends to nowhere" }, { storeResult: { mode: "live_write_failed", error: { code: "provider_rejected" } }, vapi: true });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.flagged, false);
  assert.match(r.json.say, /couldn't get the flag to save/);
  assert.equal(mails.length, 0, "no row, no owner email — nothing is claimed");
}));

test("flag_for_team: a dry-run store means NO row exists, so it is not claimed either", () => withTool("flag", async ({ call, mails }) => {
  const r = await call({ reason: "phone number still wrong on the services page" }, { storeResult: { mode: "dry_run", configured: false }, vapi: true });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.flagged, false);
  assert.equal(mails.length, 0, "a row that does not exist is never announced as flagged");
}));

// ===========================================================================
// schedule_callback — "should I call you back?" lands as a row
// ===========================================================================

test("schedule_callback happy path: row keyed by caller phone, window stored verbatim, owner emailed", () => withTool("callback", async ({ call, inserts, mails, events }) => {
  const r = await call({ topic: "the new site is live — walk me through it", window: "tomorrow morning sometime", client_ref: "WSS-1F9506" }, { vapi: true });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.scheduled, true);
  assert.equal(r.json.duplicate, false);
  assert.match(r.json.callback_id, /^cb_/);

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "ghost_agency_callbacks");
  assert.equal(inserts[0].row.requested_window, "tomorrow morning sometime", "free text, VERBATIM — no parsed appointment we cannot honour");
  assert.equal(inserts[0].row.phone_digits, "9165550000", "keyed by the caller's number from the envelope");
  assert.equal(inserts[0].row.call_id, "call-test-9");
  assert.equal(inserts[0].row.status, "open");

  assert.equal(mails.length, 1, "the team sees the request now");
  assert.match(mails[0].subject, /Callback requested/);
  assert.match(mails[0].text, /tomorrow morning sometime/);
  assert.match(mails[0].text, /Nothing dials automatically/, "the no-auto-dialer truth is IN the owner email");

  assert.ok(events.some((e) => e.name === "ghost_agency_callback_logged"));
  assert.match(r.json.say, /tomorrow morning sometime/);
  assert.doesNotMatch(r.json.say, /booked|confirmed for|at \d/i);
}));

test("schedule_callback duplicate: same caller, same topic, open row -> no second row, no second email", () => withTool("callback", async ({ call, inserts, mails }) => {
  const r = await call({ topic: "walk me through it", window: "tomorrow" }, {
    vapi: true,
    rows: [{
      callback_id: "cb_existing_1",
      phone: "+19165550000",
      topic: "walk me through it",
      requested_window: "tomorrow",
      status: "open",
      created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    }],
  });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.duplicate, true);
  assert.equal(r.json.callback_id, "cb_existing_1", "the first request stands; the caller is pointed at it");
  assert.equal(inserts.length, 0, "one request, one row");
  assert.equal(mails.length, 0, "and one owner email");
}));

test("schedule_callback: same caller but a DIFFERENT topic opens a new request", () => withTool("callback", async ({ call, inserts }) => {
  const r = await call({ topic: "billing question", window: "friday afternoon" }, {
    vapi: true,
    rows: [{
      callback_id: "cb_other_topic",
      phone: "+19165550000",
      topic: "walk me through it",
      requested_window: "tomorrow",
      status: "open",
      created_at: new Date().toISOString(),
    }],
  });
  assert.equal(r.json.duplicate, false);
  assert.equal(inserts.length, 1, "a different ask is a different callback");
}));

test("schedule_callback: a stale duplicate (>24h) does not suppress a fresh request", () => withTool("callback", async ({ call, inserts }) => {
  const r = await call({ topic: "walk me through it", window: "next week" }, {
    vapi: true,
    rows: [{
      callback_id: "cb_old",
      phone: "+19165550000",
      topic: "walk me through it",
      requested_window: "sometime",
      status: "open",
      created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    }],
  });
  assert.equal(r.json.duplicate, false);
  assert.equal(inserts.length, 1);
}));

test("schedule_callback refuses without a window or a reachable number — and asks, truthfully", () => withTool("callback", async ({ call, inserts }) => {
  const noWindow = await call({ topic: "x" }, { vapi: true });
  assert.equal(noWindow.json.refused, "window_missing");
  assert.equal(inserts.length, 0);

  const noPhone = await call({ window: "tomorrow" }, { vapi: false }); // no envelope customer number
  assert.equal(noPhone.json.refused, "phone_missing");
  assert.equal(inserts.length, 0);
}));

// ===========================================================================
// record_opt_out — the compliance row, callable on hostile calls
// ===========================================================================

test("record_opt_out happy path: DNC row written via the suppression lanes, source carries the call id", () => withTool("optout", async ({ call, suppressions, mails, events }) => {
  const r = await call({ phone: "+1 (916) 555-0000", reason: "caller asked to be taken off the list" }, { vapi: true });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.recorded, true);
  assert.equal(r.json.duplicate, false);

  assert.equal(suppressions.length, 1, "the row is written through the ONE suppression lane");
  // The lane's own normalization keeps a spoken/leading + (lib/contact-suppression.js
  // normalizedPhone), so the ledger key matches every other opt-out writer.
  assert.equal(suppressions[0].phone, "+19165550000");
  assert.match(suppressions[0].source, /^riley_voice_call:call-test-9$/, "timestamped by the lane; the call id is the source");
  assert.deepEqual(suppressions[0].channels, { call: true, text: true }, "the voice line and its number are both covered");

  assert.equal(mails.length, 1, "the owner is told once");
  assert.match(mails[0].subject, /Do-not-call recorded/);
  assert.ok(events.some((e) => e.name === "ghost_agency_dnc_recorded"));

  assert.match(r.json.say, /do-not-call list now/);
  assert.doesNotMatch(r.json.say, /\d{3}[-.\s]?\d{4}/, "the number is not read back onto a live line");
}));

test("record_opt_out with NO lookup context at all still writes the row (hostile-call contract)", () => withTool("optout", async ({ call, suppressions }) => {
  const r = await call({ phone: "9165550000" }, { vapi: false }); // flat body: no client_ref, no call id, nothing
  assert.equal(r.json.ok, true);
  assert.equal(suppressions.length, 1);
  assert.match(suppressions[0].source, /^riley_voice_call:unknown$/);
}));

test("record_opt_out duplicate: the number is already on the ledger -> refreshed, reported, owner NOT re-emailed", () => withTool("optout", async ({ call, suppressions, mails }) => {
  const r = await call({ phone: "9165550000" }, {
    vapi: true,
    rows: [{ suppression_key: "9165550000", reason: "earlier_request" }],
  });
  assert.equal(r.json.ok, true);
  assert.equal(r.json.duplicate, true, "the second request is honest about the first");
  assert.equal(suppressions.length, 1, "the row is refreshed with the new timestamp + source");
  assert.equal(mails.length, 0, "one number, one alarm");
}));

test("record_opt_out: a failed suppression write is admitted, and flagged for a human instead of faked", () => withTool("optout", async ({ call, mails }) => {
  const r = await call({ phone: "9165550000" }, {
    vapi: true,
    suppressResult: {
      suppression: { mode: "live_upsert_failed", error: { code: "provider_rejected" } },
      consent: { mode: "live_upsert", table: "consent_registrar" },
    },
  });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.recorded, false);
  assert.match(r.json.say, /won't claim it's done/);
  assert.equal(mails.length, 0);
}));

test("record_opt_out: no phone number anywhere is a refusal that asks once", () => withTool("optout", async ({ call, suppressions }) => {
  const r = await call({}, { vapi: false });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.refused, "phone_missing");
  assert.equal(suppressions.length, 0);
}));

test("record_opt_out: a dry-run suppression lane wrote nothing, so nothing is claimed", () => withTool("optout", async ({ call, mails }) => {
  const r = await call({ phone: "9165550000" }, {
    vapi: true,
    suppressResult: {
      suppression: { mode: "dry_run", configured: false, table: "ghost_agency_suppressions" },
      consent: { mode: "dry_run", configured: false, table: "consent_registrar" },
      channels: { call: true, text: true },
    },
  });
  assert.equal(r.json.ok, false);
  assert.equal(r.json.recorded, false, "a DNC row that does not exist is never announced as recorded");
  assert.equal(mails.length, 0);
}));
