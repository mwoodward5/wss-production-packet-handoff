"use strict";

// test/connect-inbox-scope.test.js — the folded-in inbox must be tenant-correct.
//
// Before this change, api/connect/messages.js and api/connect/send.js gated on
// connectAuthorized (the shared full/admin token) ALONE. A per-customer scoped
// token got 401 on both — the inbox could not be folded into the dashboard
// without handing customers the shared full-access token. These tests fail on
// that old code: a tenant reading its OWN thread returned 401.
//
// After: a scoped tenant token may read and reply in ONLY its own site's
// threads; another site's thread is a 404 (indistinguishable from a thread that
// does not exist, so a thread id is not a probe); a full/admin token is
// unrestricted; and a missing/garbage/expired token reaches nothing.
//
// The real resolveConnectScope/verifyScopeToken run here — only the data reads
// and the delivery side effects are stubbed, so what is under test is the
// scoping itself.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CONNECT_APP_TOKEN = "test-connect-secret-xyz";

const connect = require("../lib/connect");
const store = require("../lib/store");
const { signScopeToken } = require("../lib/dashboard-link");

// ---- fixtures --------------------------------------------------------------
const THREADS = {
  1: { id: 1, site_slug: "alpha", channel: "email", contact_info: "lead@alpha.com", contact_name: "Alpha Lead", subject: "Quote?" },
  2: { id: 2, site_slug: "beta", channel: "chat", contact_name: "Beta Lead" },
};
const MESSAGES = {
  1: [{ id: 11, thread_id: 1, direction: "inbound", body: "Do you do drain cleaning?", created_at: "2026-08-01T10:00:00Z" }],
  2: [{ id: 22, thread_id: 2, direction: "inbound", body: "BETA-ONLY-SECRET-BODY", created_at: "2026-08-01T10:00:00Z" }],
};

// ---- stubs (patched BEFORE the handlers are required so their destructures
// capture these) -------------------------------------------------------------
let delivered = [];
store.select = async (table, query) => {
  if (table === "connect_threads") {
    const m = /id=eq\.(\d+)/.exec(String(query));
    const id = m ? Number(m[1]) : 0;
    return { ok: true, data: THREADS[id] ? [THREADS[id]] : [] };
  }
  if (table === "connect_messages") {
    const m = /thread_id=eq\.(\d+)/.exec(String(query));
    const id = m ? Number(m[1]) : 0;
    return { ok: true, data: MESSAGES[id] || [] };
  }
  return { ok: true, data: [] };
};
store.recordEvent = async () => {};
connect.touchThread = async () => {};
connect.addMessage = async (threadId, direction, body, meta) => ({ id: 99, thread_id: threadId, direction, body, meta });
connect.deliverOutbound = async (thread, body) => {
  delivered.push({ thread: thread.id, body });
  return { channel: thread.channel, delivered: thread.channel === "email", queued: thread.channel !== "email" };
};

const messagesHandler = require("../api/connect/messages");
const sendHandler = require("../api/connect/send");

// ---- harness ---------------------------------------------------------------
function makeRes() {
  return {
    statusCode: 200, headers: {}, body: "", ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s === undefined ? "" : String(s); this.ended = true; },
  };
}
async function callMessages(tok, thread) {
  const req = { method: "GET", headers: tok ? { "x-connect-token": tok } : {}, query: { thread: String(thread) }, socket: {} };
  const res = makeRes();
  await messagesHandler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}"), raw: res.body };
}
async function callSend(tok, threadId, body) {
  const req = { method: "POST", headers: tok ? { "x-connect-token": tok, origin: "https://wss-ai.com" } : {}, body: { threadId, body } };
  const res = makeRes();
  await sendHandler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}"), raw: res.body };
}

const alphaToken = signScopeToken("alpha");
const fullToken = "test-connect-secret-xyz";
const expiredAlpha = signScopeToken("alpha", -1); // exp already in the past

// ---- messages: read scoping ------------------------------------------------
test("a tenant reads the messages in its OWN thread", async () => {
  const r = await callMessages(alphaToken, 1);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.scope, "tenant");
  assert.equal(r.json.messages.length, 1);
  assert.match(r.json.messages[0].body, /drain cleaning/);
});

test("a tenant cannot read another business's thread — 404, and nothing leaks", async () => {
  const r = await callMessages(alphaToken, 2);
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, "thread_not_found");
  assert.doesNotMatch(r.raw, /BETA-ONLY-SECRET-BODY/, "the other tenant's message body must never appear");
});

test("a tenant naming a non-existent thread gets the same 404 as a foreign one", async () => {
  const r = await callMessages(alphaToken, 999);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, "thread_not_found");
});

test("a full/admin token may open any thread", async () => {
  const r = await callMessages(fullToken, 2);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.scope, "full");
  assert.equal(r.json.messages.length, 1);
});

// ---- send: reply scoping ---------------------------------------------------
test("a tenant replies in its OWN thread and delivery runs", async () => {
  delivered = [];
  const r = await callSend(alphaToken, 1, "Yes, we handle drains.");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].thread, 1);
});

test("a tenant cannot reply into another business's thread — 404, and nothing is delivered", async () => {
  delivered = [];
  const r = await callSend(alphaToken, 2, "I should not be able to send this.");
  assert.equal(r.status, 404);
  assert.equal(r.json.ok, false);
  assert.equal(delivered.length, 0, "deliverOutbound must not run for a foreign thread");
});

test("a full/admin token may reply in any thread", async () => {
  delivered = [];
  const r = await callSend(fullToken, 2, "Operator reply.");
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(delivered.length, 1);
});

// ---- fail closed -----------------------------------------------------------
test("no token reaches nothing on either endpoint", async () => {
  assert.equal((await callMessages("", 1)).status, 401);
  assert.equal((await callSend("", 1, "hi")).status, 401);
});

test("a garbage token reaches nothing", async () => {
  assert.equal((await callMessages("not-a-real-token", 1)).status, 401);
  assert.equal((await callSend("not-a-real-token", 1, "hi")).status, 401);
});

test("an EXPIRED scope token reaches nothing — expiry does not fail open", async () => {
  const rm = await callMessages(expiredAlpha, 1);
  assert.equal(rm.status, 401, "an expired tenant token must not read messages");
  const rs = await callSend(expiredAlpha, 1, "hi");
  assert.equal(rs.status, 401, "an expired tenant token must not send");
});
