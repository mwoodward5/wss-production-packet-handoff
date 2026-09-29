"use strict";

// WSS Connect owner proof — welded v2 edition.
//
// The app is still a single static HTML file plus a service worker, but the
// v2 redesign split the page into two inline scripts: the backend ADAPTER
// (window.CONNECT_DATA — API base, token key, PIN cipher, push flow,
// magic-link hash contract) followed by a UI IIFE that talks to business data
// only through that object. The adapter is the public seam, so the app-side
// tests here boot the adapter alone and drive it exactly the way the UI does.
//
// RETIRED WITH THE REDESIGN (each pinned removed v1 internals; the losses are
// reported as regressions, not hidden):
//   - the durable offline OUTBOX suite (fingerprint-keyed queue, drain locks,
//     draft preservation): v2 has no outbox — an offline reply fails honestly
//     in the composer instead of queueing. The server-side idempotency those
//     tests fed still holds and is still tested below; the adapter still
//     mints a canonical UUID per send so a retried tap cannot double-email.
//   - the multi-tenant LOGIN-RACE suite (generation counters, cross-tab
//     latest-intent-wins, late-response quarantine): v2 has no login screen
//     and no per-tenant outbox to protect. The one invariant that survives —
//     a token swap detaches this device's old push subscription — has its own
//     test below.
//   - the v1 RENDER fixtures (initials/avatars, day separators, install card,
//     toast XSS, badge-driven list) and the v1 STYLESHEET proofs (390px
//     shell bounds, gradient AA against the --void token): that shell and its
//     helpers no longer exist; v2 ships its own design and its own escaping.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const {
  API,
  TOKEN_KEY,
  bootAdapter,
  memoryStorage,
  readPage,
} = require("./fixtures/connect-v2-adapter-harness.js");

const connectDir = path.resolve(__dirname, "../../connect");
const manifestPath = path.join(connectDir, "manifest.json");
const workerPath = path.join(connectDir, "sw.js");
const connectModulePath = require.resolve("../lib/connect.js");
const connectStorePath = require.resolve("../lib/store.js");
const connectEmailPath = require.resolve("../lib/email.js");
const dashboardLinkPath = require.resolve("../lib/dashboard-link.js");
const sendEndpointPath = require.resolve("../api/connect/send.js");
const outboxSqlPath = path.resolve(__dirname, "../sql/connect_outbox_idempotency.sql");

const PIN_CIPHER = "543484b0e3b719911cda580d12100b4849f71351630fbec70199ba6bda5df9377f0f7edc1339f7dc0eb49c14e971e250";
const PIN_VERIFY = "2e6ad7e4c7d594ab1d057fdd6a7df80895238b037eee2ee12659df6df4b2f0b8";
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path.basename(file)} must be a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function bootWorker() {
  const source = fs.readFileSync(workerPath, "utf8");
  const handlers = Object.create(null);
  const cacheEntries = new Map();
  const puts = [];
  let network = async () => { throw new Error("offline"); };
  const keyFor = (value) => typeof value === "string" ? value : String(value?.url || value);
  const cache = {
    addAll: async () => {},
    async put(request, value) { const key = keyFor(request); puts.push(key); cacheEntries.set(key, value); },
    async match(request) { return cacheEntries.get(keyFor(request)); },
  };
  const sandbox = {
    console,
    URL,
    Promise,
    encodeURIComponent,
    fetch(request) { return network(request); },
    caches: {
      async open() { return cache; },
      async keys() { return ["wss-connect-old"]; },
      async delete() { return true; },
      async match(request) { return cache.match(request); },
    },
    self: {
      location: { origin: "https://connect.wss-labs.com" },
      clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
      registration: { showNotification: async () => {} },
      skipWaiting: async () => {},
      addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    },
  };
  new vm.Script(source, { filename: "wss-connect-sw.js" }).runInNewContext(sandbox);
  return {
    source,
    puts,
    cacheEntries,
    setNetwork(fn) { network = fn; },
    async fetchEvent(request) {
      let responsePromise;
      const event = { request, respondWith(value) { responsePromise = Promise.resolve(value); } };
      for (const fn of handlers.fetch || []) fn(event);
      return { handled: Boolean(responsePromise), response: responsePromise ? await responsePromise : undefined };
    },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    end(value) { this.body = value === undefined ? "" : String(value); return this; },
  };
}

function parsed(res) { return res.body ? JSON.parse(res.body) : {}; }

function installModule(pathname, exports) {
  require.cache[pathname] = { id: pathname, filename: pathname, loaded: true, exports };
}

async function withConnectStore(stubs, run) {
  const saved = new Map([
    [connectModulePath, require.cache[connectModulePath]],
    [connectStorePath, require.cache[connectStorePath]],
    [connectEmailPath, require.cache[connectEmailPath]],
    [dashboardLinkPath, require.cache[dashboardLinkPath]],
  ]);
  try {
    installModule(connectStorePath, {
      conditionalUpdate: stubs.conditionalUpdate || (async () => ({ ok: true, updated: false, rows: [] })),
      insertRow: stubs.insertRow || (async () => ({ mode: "live_write_failed", error: { code: "test" } })),
      select: stubs.select || (async () => ({ ok: true, data: [] })),
    });
    installModule(connectEmailPath, { sendResendEmail: stubs.sendResendEmail || (async () => ({ ok: true, id: "email-test" })) });
    installModule(dashboardLinkPath, { verifyScopeToken: () => ({ ok: false }) });
    delete require.cache[connectModulePath];
    const connect = require(connectModulePath);
    return await run(connect);
  } finally {
    delete require.cache[connectModulePath];
    for (const [pathname, entry] of saved) {
      if (entry) require.cache[pathname] = entry;
      else delete require.cache[pathname];
    }
  }
}

async function callSend({
  body,
  scope = { mode: "tenant", siteSlug: "alpha-plumbing" },
  thread = { id: 41, site_slug: "alpha-plumbing", channel: "chat", meta: { source: "site_widget" } },
  reservation,
  delivery = { channel: "chat", delivered: true, via: "visitor_poll" },
  completed,
} = {}) {
  const savedConnect = require.cache[connectModulePath];
  const savedStore = require.cache[connectStorePath];
  const savedSend = require.cache[sendEndpointPath];
  const realConnect = require(connectModulePath);
  const trace = [];
  const events = [];
  let deliverCalls = 0;
  let reserveCalls = 0;
  try {
    installModule(connectModulePath, {
      resolveConnectScope: () => scope,
      readBody: async (req) => req.body,
      addMessage: async () => { trace.push("add"); return { id: 901 }; },
      normalizeClientMessageId: realConnect.normalizeClientMessageId,
      reserveOutboundMessage: async (input) => {
        reserveCalls += 1;
        trace.push("reserve");
        return reservation || {
          state: "reserved",
          message: {
            id: 901,
            thread_id: input.thread.id,
            body: input.text,
            client_message_id: input.clientMessageId,
            delivery_status: "pending",
            delivery_lease_token: "2b32b74a-c114-4b84-b233-10d879370641",
          },
        };
      },
      completeOutboundMessage: async ({ reservation: held, delivery: result }) => {
        trace.push("complete");
        return completed || {
          message: { ...held.message, delivery_status: "completed" },
          delivery: result,
          idempotent: false,
        };
      },
      touchThread: async () => { trace.push("touch"); },
      deliverOutbound: async (_thread, _text, options) => {
        deliverCalls += 1;
        trace.push("deliver");
        if (delivery instanceof Error) throw delivery;
        return typeof delivery === "function" ? delivery(options) : delivery;
      },
    });
    installModule(connectStorePath, {
      select: async () => ({ ok: true, data: thread ? [thread] : [] }),
      recordEvent: async (type, payload) => { trace.push("event"); events.push({ type, payload }); },
    });
    delete require.cache[sendEndpointPath];
    const handler = require(sendEndpointPath);
    const req = { method: "POST", headers: { origin: "https://connect.wss-labs.com" }, body: body || {} };
    const res = makeRes();
    await handler(req, res);
    return { res, json: parsed(res), trace, events, deliverCalls, reserveCalls };
  } finally {
    delete require.cache[sendEndpointPath];
    if (savedConnect) require.cache[connectModulePath] = savedConnect; else delete require.cache[connectModulePath];
    if (savedStore) require.cache[connectStorePath] = savedStore; else delete require.cache[connectStorePath];
    if (savedSend) require.cache[sendEndpointPath] = savedSend;
  }
}

// --- The page: still self-contained, still installable ----------------------

test("the self-contained app and service worker both parse without a build step", () => {
  const { html, scripts } = readPage();
  scripts.forEach((source, index) => new vm.Script(source, { filename: `wss-connect-inline-${index}.js` }));
  new vm.Script(fs.readFileSync(workerPath, "utf8"), { filename: "wss-connect-sw.js" });

  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']https?:|@import\s+(?:url\()?\s*["']?https?:/i);
  assert.doesNotMatch(html, /cdnjs|unpkg|jsdelivr|fonts\.googleapis|use\.fontawesome/i);
});

test("the real adapter installs before the UI IIFE, and the demo stays behind ?demo=1", async () => {
  const { uiSource } = readPage();
  // The UI's guard keeps whichever adapter runs first — the whole load-order
  // mechanism this weld depends on.
  assert.match(uiSource, /window\.CONNECT_DATA\s*=\s*window\.CONNECT_DATA\s*\|\|\s*defaultAdapter/);

  const live = await bootAdapter({ token: "tenant-token-install-proof" });
  for (const method of [
    "listConversations", "getThread", "sendReply", "registerPush", "setClientCode",
    "getPushState", "getBusiness", "listConnections", "connectAccount", "disconnectAccount",
  ]) {
    assert.equal(typeof live.adapter[method], "function", `CONNECT_DATA.${method} must be implemented`);
  }

  // With ?demo=1 the real adapter must stand aside so the UI's sample-data
  // adapter (and its no-fabricated-names demo) still works.
  const demo = await bootAdapter({ search: "?demo=1" });
  assert.equal(demo.adapter, undefined, "the demo page keeps the UI's built-in sample adapter");
});

test("the shipped login token, PIN verifier, and authenticated API door survive the redesign", () => {
  const { adapterSource: source } = readPage();
  // Same localStorage key: every phone already signed in stays signed in.
  assert.match(source, new RegExp(`TOKEN_KEY\\s*=\\s*["']${TOKEN_KEY}["']`));
  assert.match(source, /localStorage\.getItem\(TOKEN_KEY\)/);
  assert.match(source, /localStorage\.setItem\(TOKEN_KEY,/);
  // Same PIN cipher: every 6-digit PIN already emailed keeps unlocking.
  assert.match(source, new RegExp(`PIN_CIPHER\\s*=\\s*["']${PIN_CIPHER}["']`));
  assert.match(source, new RegExp(`PIN_VERIFY\\s*=\\s*["']${PIN_VERIFY}["']`));
  assert.match(source, /function\s+tokenFromPin\s*\(/);
  // Same backend door and credential header.
  assert.match(source, new RegExp(`API\\s*=\\s*["']${API.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`));
  assert.match(source, /\["x-connect-token"\]\s*=/);
  for (const endpoint of ["/threads", "/messages?thread=", "/send"]) assert.ok(source.includes(endpoint), `${endpoint} must remain wired`);
  assert.doesNotMatch(source, /wsl_admin_token/, "the client app must not switch to the operator-console credential");
  // RETIRED: localStorage.removeItem(TOKEN_KEY) — v1 cleared the token on 401
  // because it had a login screen to fall back to. v2 has none, so a transient
  // backend blip must not sign the owner out of the only door they have; the
  // stored token survives and the inbox says the honest thing instead.
});

test("the preserved token still authenticates the existing thread door", async () => {
  const token = "tenant-token-auth-header-proof";
  const page = await bootAdapter({ token });
  await page.adapter.listConversations();
  const threadRead = page.calls.find((call) => call.url === `${API}/threads`);
  assert.ok(threadRead);
  assert.equal(threadRead.init.headers["x-connect-token"], token);
  assert.equal(page.storage.getItem(TOKEN_KEY), token);
});

test("without a token the inbox refuses in plain words before any network call", async () => {
  const page = await bootAdapter({ token: "" });
  await assert.rejects(() => page.adapter.listConversations(), /Client ID/i);
  assert.equal(page.calls.length, 0, "no credentials means no request, not a doomed one");
});

// --- Wire translation: backend rows onto the v2 contract --------------------

test("backend thread rows are translated onto the v2 conversation contract", async () => {
  const threads = [
    { id: 41, channel: "call", contact_name: "Dana Kerr", contact_phone: "+1 (949) 555-0199", first_line: "Missed you — call me back", unread: true, needs_reply: true, last_message_at: "2026-08-20T15:00:00.000Z" },
    { id: 42, channel: "voicemail", contact_name: "", contact_phone: "", first_line: "", subject: "New voicemail", unread: false, needs_reply: false, last_message_at: "2026-08-20T14:00:00.000Z" },
    { id: 43, channel: "chat", contact_name: "Sam Lee", first_line: "Are you open Saturday?", unread: true, needs_reply: false, last_message_at: "2026-08-20T13:00:00.000Z" },
    { id: 44, channel: "email", contact_name: "Alex Morgan", subject: "Estimate", unread: 0, last_message_at: "2026-08-20T12:00:00.000Z" },
  ];
  const page = await bootAdapter({ threads });
  const list = await page.adapter.listConversations();

  // The raw response is { ok, threads } — an object. Receiving an array here
  // proves the unwrap that the reference student adapter got wrong.
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 4);

  const [call, voicemail, chat, email] = list;
  assert.equal(call.name, "Dana Kerr", "contact_name becomes name");
  assert.equal(call.phone, "+1 (949) 555-0199", "contact_phone becomes phone");
  assert.equal(call.preview, "Missed you — call me back", "first_line becomes preview");
  assert.equal(call.channel, "missed_call", "a call is a missed call to the owner");
  assert.equal(call.unread, true);
  assert.equal(call.isNew, true, "needs_reply drives the NEW badge");
  assert.equal(call.updatedAt, "2026-08-20T15:00:00.000Z", "last_message_at becomes updatedAt");

  assert.equal(voicemail.channel, "missed_call", "a voicemail is a missed call too");
  assert.equal(voicemail.preview, "New voicemail", "the subject is the honest preview fallback");
  assert.equal(voicemail.isNew, false, "an answered lead is not NEW no matter how recent");

  assert.equal(chat.channel, "chat");
  assert.equal(email.channel, "email", "unknown-to-v2 channels pass through so the UI can label them honestly");

  // The app badge mirrors the measured unread count (parity with v1).
  assert.deepEqual(page.badgeCalls.at(-1), ["set", 2]);
});

test("backend messages are translated with honest delivery words", async () => {
  const messages = [
    { id: 1, direction: "inbound", body: "The water heater stopped Sunday.", created_at: "2026-08-20T10:00:00.000Z" },
    { id: 2, direction: "outbound", body: "On our way", created_at: "2026-08-20T10:05:00.000Z", meta: { delivery: { status: "pending" } } },
    { id: 3, direction: "outbound", body: "All done", created_at: "2026-08-20T10:10:00.000Z", meta: { delivery: { delivered: true } } },
    { id: 4, direction: "outbound", body: "Please confirm", created_at: "2026-08-20T10:15:00.000Z", meta: { delivery: { status: "delivery_unknown", manual: true } } },
  ];
  const page = await bootAdapter({ messages });
  const thread = await page.adapter.getThread(41);

  assert.equal(String(thread.id), "41");
  const [inbound, pending, sent, unknown] = thread.messages;
  assert.equal(inbound.direction, "in");
  assert.equal(inbound.text, "The water heater stopped Sunday.", "body becomes text");
  assert.equal(inbound.createdAt, "2026-08-20T10:00:00.000Z", "created_at becomes createdAt");
  assert.equal("status" in inbound, false, "inbound messages carry no delivery claim");

  assert.equal(pending.direction, "out");
  assert.match(pending.status, /sending/i, "a pending delivery is never labeled Sent");
  assert.equal(sent.status, "Sent");
  assert.match(unknown.status, /not confirmed/i, "ambiguous provider delivery is never labeled Sent");
  assert.doesNotMatch(unknown.status, /^Sent$/);
});

test("replies ride the server idempotency door with a canonical browser UUID", async () => {
  const sentBodies = [];
  const page = await bootAdapter({
    routes: {
      "/send": (_url, init, answer) => {
        const body = JSON.parse(String(init.body));
        sentBodies.push(body);
        return answer({
          ok: true,
          message: { id: 902, thread_id: body.threadId, direction: "outbound", body: body.body, created_at: "2026-08-20T16:00:00.000Z", meta: { delivery: { delivered: true } } },
          delivery: { channel: "chat", delivered: true },
        });
      },
    },
  });
  const returned = await page.adapter.sendReply(41, "We can help");

  assert.equal(sentBodies.length, 1);
  assert.equal(sentBodies[0].threadId, 41, "the wire threadId is numeric");
  assert.equal(sentBodies[0].body, "We can help");
  assert.match(sentBodies[0].clientMessageId, CANONICAL_UUID, "every reply opts into server-side double-send protection");

  assert.equal(returned.text, "We can help", "the echoed message maps body onto text before the UI reads it");
  assert.equal(returned.direction, "out");
  assert.equal(returned.status, "Sent");
});

test("a 409 in-progress reply surfaces honest words, never a fake state", async () => {
  const page = await bootAdapter({
    routes: {
      "/send": (_url, _init, answer) => answer({ ok: false, error: "message_in_progress", retryable: true, retryAfterMs: 2000 }, 409),
    },
  });
  await assert.rejects(() => page.adapter.sendReply(41, "Twice?"), /already sending/i);

  const unknown = await bootAdapter({
    routes: {
      "/send": (_url, _init, answer) => answer({ ok: false, error: "delivery_unknown", manual: true }, 409),
    },
  });
  await assert.rejects(() => unknown.adapter.sendReply(41, "Maybe sent"), /can't confirm/i);
});

// --- setClientCode: the only auth surface v2 has ----------------------------

test("setClientCode adopts only credentials the backend accepts", async () => {
  const oldToken = "tenant-token-old";
  const goodToken = "tenant-token-brand-new";
  const accepted = new Set([oldToken, goodToken]);
  const routes = {
    "/threads": (_url, init, answer) => {
      const presented = init.headers["x-connect-token"];
      if (!accepted.has(presented)) return answer({ ok: false, error: "unauthorized" }, 401);
      return answer({ ok: true, threads: [], scope: "tenant" });
    },
  };

  const page = await bootAdapter({ token: oldToken, routes });
  await page.adapter.setClientCode(goodToken);
  assert.equal(page.storage.getItem(TOKEN_KEY), goodToken, "a verified token persists under the same device key");

  await assert.rejects(() => page.adapter.setClientCode("not-a-real-token"), /didn't work/i);
  assert.equal(page.storage.getItem(TOKEN_KEY), goodToken, "a refused code never overwrites a working login");

  // A wrong 6-digit PIN fails the cipher's own sha256 check locally — no
  // request is spent discovering what the math already knows.
  const before = page.calls.length;
  await assert.rejects(() => page.adapter.setClientCode("123456"), /didn't work/i);
  assert.equal(page.calls.length, before);
  assert.equal(page.storage.getItem(TOKEN_KEY), goodToken);
});

test("email + PIN sign in through dashboard-login without leaking a token header", async () => {
  const scoped = "s2.alpha-plumbing.99999.signature";
  const page = await bootAdapter({
    token: "",
    routes: {
      "/dashboard-login": (_url, init, answer) => {
        assert.equal(String(init.method).toUpperCase(), "POST");
        // dashboard-login's CORS allowlist admits only Content-Type; a token
        // header here would fail the preflight before the PIN is judged.
        assert.equal("x-connect-token" in init.headers, false, "login carries no credential it does not have yet");
        const body = JSON.parse(String(init.body));
        assert.equal(body.email, "owner@business.com");
        assert.equal(body.pin, "123456");
        return answer({ ok: true, token: scoped, scoped: true });
      },
      "/threads": (_url, init, answer) => {
        if (init.headers["x-connect-token"] !== scoped) return answer({ ok: false, error: "unauthorized" }, 401);
        return answer({ ok: true, threads: [], scope: "tenant" });
      },
    },
  });
  await page.adapter.setClientCode("Owner@Business.com 123456");
  assert.equal(page.storage.getItem(TOKEN_KEY), scoped, "the scoped token — never the shared one — is what persists");

  const refused = await bootAdapter({
    token: "",
    routes: {
      "/dashboard-login": (_url, _init, answer) => answer({ ok: false, error: "invalid_credentials" }, 401),
    },
  });
  await assert.rejects(() => refused.adapter.setClientCode("owner@business.com 000000"), /didn't match/i);
  assert.equal(refused.storage.getItem(TOKEN_KEY), null);
});

// --- The hash contract: push taps and magic links keep working --------------

test("a magic link #t= unlocks at boot, clears the hash, and keeps the same device key", async () => {
  const magic = "tenant-token-from-magic-link";
  const page = await bootAdapter({
    token: "",
    storage: memoryStorage({}),
    hash: `#t=${magic}`,
  });
  assert.equal(page.storage.getItem(TOKEN_KEY), magic, "the link's token is verified and persisted before the UI's first load");
  const boot = page.calls.find((call) => call.url === `${API}/threads`);
  assert.equal(boot.init.headers["x-connect-token"], magic, "adoption happens on the same door the inbox uses");
  assert.ok(page.replaceStates.length >= 1, "the credential never lingers in the visible URL or history");

  const expired = await bootAdapter({
    token: "",
    storage: memoryStorage({}),
    hash: "#t=expired-link-token",
    routes: { "/threads": (_url, _init, answer) => answer({ ok: false, error: "unauthorized" }, 401) },
  });
  assert.equal(expired.storage.getItem(TOKEN_KEY), null, "an expired link persists nothing");
  assert.ok(expired.replaceStates.length >= 1, "even an expired credential is scrubbed from the URL");
  await assert.rejects(() => expired.adapter.listConversations(), /Client ID/i);
});

test("a push tap's #thread= deep link opens that conversation through the UI's own rendered row", async () => {
  const clicks = [];
  const makeButton = (label) => ({ click() { clicks.push(label); } });
  const buttons = [makeButton("row-41"), makeButton("row-42")];
  const threads = [
    { id: 41, channel: "chat", contact_name: "Dana Kerr", unread: true, needs_reply: true, last_message_at: "2026-08-20T15:00:00.000Z" },
    { id: 42, channel: "chat", contact_name: "Sam Lee", unread: false, last_message_at: "2026-08-20T14:00:00.000Z" },
  ];
  const page = await bootAdapter({
    hash: "#thread=41",
    threads,
    conversationButtons: buttons,
  });
  // The UI drives loadInbox exactly like this at boot; the adapter answers,
  // the rows render, and the pending id becomes one synthetic click on the
  // matching row — walking the UI's real openThread path.
  await page.adapter.listConversations();
  await page.settle();
  assert.deepEqual(clicks, ["row-41"], "the newest-first sort maps the thread id onto the right row exactly once");

  await page.adapter.listConversations();
  await page.settle();
  assert.deepEqual(clicks, ["row-41"], "a consumed deep link never re-opens the thread on later refreshes");
});

test("a deep link to a thread outside this inbox is dropped, not misdelivered", async () => {
  const clicks = [];
  const page = await bootAdapter({
    hash: "#thread=9999",
    threads: [{ id: 41, channel: "chat", contact_name: "Dana Kerr", last_message_at: "2026-08-20T15:00:00.000Z" }],
    conversationButtons: [{ click() { clicks.push("row-41"); } }],
  });
  await page.adapter.listConversations();
  await page.settle();
  assert.deepEqual(clicks, [], "a foreign or stale thread id must never open someone else's row");
});

// --- Device hygiene and background behavior ---------------------------------

test("token replacement detaches this device's old push subscription", async () => {
  const detached = [];
  const accepted = new Set(["tenant-token-alpha", "tenant-token-beta"]);
  const page = await bootAdapter({
    token: "tenant-token-alpha",
    pushSubscription: { async unsubscribe() { detached.push("unsubscribe"); return true; } },
    routes: {
      "/threads": (_url, init, answer) => {
        if (!accepted.has(init.headers["x-connect-token"])) return answer({ ok: false, error: "unauthorized" }, 401);
        return answer({ ok: true, threads: [], scope: "tenant" });
      },
    },
  });
  await page.adapter.setClientCode("tenant-token-beta");
  assert.deepEqual(detached, ["unsubscribe"], "business A's phone must not keep receiving pushes once B signs in");
  assert.equal(page.storage.getItem(TOKEN_KEY), "tenant-token-beta");
});

test("the 20-second poll rings the UI's quiet-refresh doorbell only when it can help", async () => {
  const page = await bootAdapter({ token: "tenant-token-poll-proof" });
  const poll = page.intervals.find((entry) => entry.ms === 20000);
  assert.ok(poll, "v1's 20s background refresh survives the redesign");

  poll.fn();
  assert.deepEqual(page.docEvents, ["visibilitychange"], "the poll reuses the UI's own visible-inbox-only refresh gate");

  page.sandbox.navigator.onLine = false;
  poll.fn();
  assert.equal(page.docEvents.length, 1, "offline polls stay silent instead of queueing failures");

  const signedOut = await bootAdapter({ token: "" });
  const idlePoll = signedOut.intervals.find((entry) => entry.ms === 20000);
  idlePoll.fn();
  assert.equal(signedOut.docEvents.length, 0, "no token means nothing worth polling for");
});

test("cross-tab token changes are adopted by the storage listener", async () => {
  const page = await bootAdapter({ token: "tenant-token-tab-one" });
  await page.emit("storage", { key: TOKEN_KEY, newValue: "tenant-token-tab-two" });
  assert.ok(page.docEvents.includes("visibilitychange"), "the other tab's sign-in triggers a quiet refresh here");

  await page.adapter.listConversations();
  const read = page.calls.find((call) => call.url === `${API}/threads`);
  assert.equal(read.init.headers["x-connect-token"], "tenant-token-tab-two", "later reads speak as the newly adopted tenant");

  const before = page.docEvents.length;
  await page.emit("storage", { key: "unrelated-key", newValue: "x" });
  assert.equal(page.docEvents.length, before, "unrelated storage traffic is ignored");
});

test("the app badge is progressive enhancement and never required", async () => {
  const page = await bootAdapter({
    withBadging: false,
    threads: [{ id: 41, channel: "chat", unread: true, last_message_at: "2026-08-20T15:00:00.000Z" }],
  });
  const list = await page.adapter.listConversations();
  assert.equal(list.length, 1, "a browser without the Badging API still gets its inbox");
});

// --- Install surface --------------------------------------------------------

test("manifest and first-party icon files cover install, splash, maskable, and Apple sizes", () => {
  const { html } = readPage();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.name, "WSS Connect");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.match(html, /<link\b[^>]*rel=["']manifest["'][^>]*href=["']\/manifest\.json["']/i, "the page must point at the DEPLOYED manifest name");
  assert.match(html, /<link\b(?=[^>]*rel=["']apple-touch-icon["'])(?=[^>]*href=["']\/apple-touch-icon\.png["'])[^>]*>/i);
  assert.match(html, /<meta\b[^>]*name=["']theme-color["']/i);
  // RETIRED: the html-theme-color === manifest-theme-color equality. The v1
  // shell was dark (#08080B) and matched its manifest; v2 ships a light
  // visual identity while manifest.json (deliberately untouched by this weld)
  // still says #08080B for the splash. Re-align the manifest when the owner
  // blesses the v2 palette — the page must not lie about its own chrome color
  // in the meantime.

  const expected = [
    ["/wss-connect-icon-192.png", "192x192", "any", 192],
    ["/wss-connect-icon-512.png", "512x512", "any", 512],
    ["/wss-connect-maskable-512.png", "512x512", "maskable", 512],
  ];
  for (const [src, sizes, purpose, pixels] of expected) {
    const icon = manifest.icons.find((candidate) => candidate.src === src);
    assert.ok(icon, `${src} must be declared`);
    assert.equal(icon.sizes, sizes);
    assert.equal(icon.type, "image/png");
    assert.equal(icon.purpose, purpose);
    assert.deepEqual(pngSize(path.join(connectDir, src.slice(1))), { width: pixels, height: pixels });
  }
  assert.deepEqual(pngSize(path.join(connectDir, "apple-touch-icon.png")), { width: 180, height: 180 });
});

test("the page registers the deployed service worker path", () => {
  const { uiSource } = readPage();
  // The deployed worker is /sw.js — apps/connect/vercel.json no-caches exactly
  // that path so updates always reach installed apps. v2 shipped pointing at a
  // ./service-worker.js that does not exist here.
  assert.match(uiSource, /register\(["']\/sw\.js["']\)/);
  assert.doesNotMatch(uiSource, /service-worker\.js/);
});

// --- Service worker (unchanged by the weld, still owner-proof) --------------

test("the service worker caches only same-origin GET shell assets and keeps legal routes separate", async () => {
  const worker = bootWorker();
  assert.doesNotMatch(worker.source, /indexedDB|BackgroundSync|connect-outbox|clientMessageId/i, "auth-bearing replies belong to the page, not the worker cache");

  for (const request of [
    { url: `${API}/send`, method: "POST", mode: "cors" },
    { url: "https://connect.wss-labs.com/api/connect/threads", method: "GET", mode: "cors" },
    { url: "https://attacker.example/privacy.html", method: "GET", mode: "navigate" },
  ]) {
    const result = await worker.fetchEvent(request);
    assert.equal(result.handled, false, `${request.method} ${request.url} must bypass the shell cache`);
  }

  const makeNetworkResponse = (name) => ({ ok: true, name, clone() { return { ok: true, name }; } });
  worker.setNetwork(async (request) => makeNetworkResponse(new URL(request.url).pathname));
  for (const pathname of ["/", "/privacy.html", "/terms.html"]) {
    const request = { url: `https://connect.wss-labs.com${pathname}`, method: "GET", mode: "navigate" };
    const result = await worker.fetchEvent(request);
    assert.equal(result.handled, true);
    assert.equal(result.response.name, pathname);
  }
  assert.deepEqual(worker.puts, [
    "https://connect.wss-labs.com/",
    "https://connect.wss-labs.com/privacy.html",
    "https://connect.wss-labs.com/terms.html",
  ], "privacy and terms must never overwrite the cached root shell");
  worker.setNetwork(async () => { throw new Error("offline"); });
  for (const pathname of ["/privacy.html", "/terms.html"]) {
    const offline = await worker.fetchEvent({ url: `https://connect.wss-labs.com${pathname}`, method: "GET", mode: "navigate" });
    assert.equal(offline.response.name, pathname, `${pathname} restores its own cached document`);
  }
});

// --- Backend reply idempotency (server-side; unchanged by the weld) ---------

test("owner reply IDs are canonical UUIDs and the durable reservation precedes delivery", async () => {
  const id = "7ebeb2da-4db1-4c97-a85e-1eb08ba78092";
  const bad = await callSend({ body: { threadId: 41, body: "Hello", clientMessageId: "wss-not-a-uuid" } });
  assert.equal(bad.res.statusCode, 400);
  assert.equal(bad.json.error, "client_message_id_invalid");
  assert.equal(bad.reserveCalls, 0);
  assert.equal(bad.deliverCalls, 0);

  let providerKey = "";
  const good = await callSend({
    body: { threadId: 41, body: "Hello", clientMessageId: id.toUpperCase() },
    delivery(options) {
      providerKey = options.idempotencyKey;
      return { channel: "email", delivered: true, detail: { id: "provider-secret-detail" } };
    },
  });
  assert.equal(good.res.statusCode, 200, good.res.body);
  assert.ok(good.trace.indexOf("reserve") < good.trace.indexOf("deliver"), "the pending row is durable before provider delivery");
  assert.ok(good.trace.indexOf("deliver") < good.trace.indexOf("complete"), "completion follows confirmed delivery");
  assert.equal(providerKey, `wss-connect/41/${id}`, "every retry reuses one stable provider idempotency key");
  assert.equal(good.events.length, 1);
  assert.deepEqual(
    Object.keys(good.events[0].payload).sort(),
    ["channel", "delivered", "idempotent", "queued", "replay", "scope", "threadId"].sort(),
    "events exclude reply bodies, client IDs, and provider detail",
  );
  assert.doesNotMatch(JSON.stringify(good.events), /Hello|7ebeb2da|provider-secret-detail/);
});

test("the reply idempotency columns are tenant-thread unique and closed to browser database roles", () => {
  const sql = fs.readFileSync(outboxSqlPath, "utf8");
  assert.match(sql, /add column if not exists client_message_id text/i);
  assert.match(sql, /client_message_id\s*~\*\s*'\^\[0-9a-f\]/i, "the database repeats the canonical UUID gate");
  assert.match(sql, /unique index[\s\S]*on public\.connect_messages\s*\(thread_id,\s*client_message_id\)/i);
  assert.match(sql, /delivery_status[\s\S]*pending[\s\S]*completed[\s\S]*delivery_unknown/i);
  assert.match(sql, /alter table public\.connect_messages enable row level security/i);
  assert.match(sql, /revoke all on table public\.connect_messages from anon, authenticated/i);
});

test("completed duplicates replay once, body conflicts refuse, and tenant mismatch stays opaque", async () => {
  const id = "40b31f52-a8ce-4d17-afc5-cc21e757e1ad";
  const complete = await callSend({
    body: { threadId: 41, body: "Same body", clientMessageId: id },
    reservation: {
      state: "completed",
      message: { id: 77, thread_id: 41, body: "Same body", client_message_id: id, delivery_status: "completed" },
      delivery: { channel: "chat", delivered: true, via: "visitor_poll" },
    },
  });
  assert.equal(complete.res.statusCode, 200);
  assert.equal(complete.json.idempotent, true);
  assert.equal(complete.deliverCalls, 0, "a completed replay never contacts the delivery channel again");

  const conflict = await callSend({
    body: { threadId: 41, body: "Changed body", clientMessageId: id },
    reservation: { state: "conflict", message: { id: 77 } },
  });
  assert.equal(conflict.res.statusCode, 409);
  assert.equal(conflict.json.error, "client_message_conflict");
  assert.equal(conflict.json.retryable, false);
  assert.equal(conflict.deliverCalls, 0);

  const mismatch = await callSend({
    scope: { mode: "tenant", siteSlug: "beta-roofing" },
    body: { threadId: 41, body: "Same body", clientMessageId: id },
  });
  assert.equal(mismatch.res.statusCode, 404);
  assert.equal(mismatch.json.error, "thread not found");
  assert.equal(mismatch.reserveCalls, 0, "tenant ownership is checked before duplicate state can leak");
  assert.equal(mismatch.deliverCalls, 0);
});

test("two concurrent claims create one reservation and permit one provider delivery", async () => {
  const now = Date.parse("2026-08-09T18:00:00.000Z");
  const id = "e786bed0-8c03-4d63-86cf-b75b24fb09a5";
  let stored = null;
  let inserts = 0;
  let providerCalls = 0;
  await withConnectStore({
    insertRow: async (_table, row) => {
      if (!stored) {
        inserts += 1;
        stored = { id: 777, created_at: new Date(now).toISOString(), ...row };
        return { mode: "live_write", row: [stored] };
      }
      return {
        mode: "live_write_failed",
        error: { code: "23505", details: "connect_messages_thread_client_message_uidx (thread_id, client_message_id)" },
      };
    },
    select: async () => ({ ok: true, data: stored ? [stored] : [] }),
    sendResendEmail: async () => { providerCalls += 1; return { ok: true, id: "resend-one" }; },
  }, async (connect) => {
    const input = {
      thread: { id: 41, channel: "email", contact_info: "owner@example.test", subject: "Question" },
      text: "One reply",
      clientMessageId: id,
      nowMs: now,
    };
    const claims = await Promise.all([
      connect.reserveOutboundMessage(input),
      connect.reserveOutboundMessage(input),
    ]);
    assert.deepEqual(claims.map((claim) => claim.state).sort(), ["in_progress", "reserved"]);
    for (const claim of claims) {
      if (claim.state === "reserved") {
        await connect.deliverOutbound(input.thread, input.text, { idempotencyKey: `wss-connect/41/${id}` });
      }
    }
  });
  assert.equal(inserts, 1);
  assert.equal(providerCalls, 1);
});

test("pending duplicate replies expose a bounded retry and never claim an unconfirmed delivery", async () => {
  const id = "35f74994-8e23-47be-b236-4abb6745baf0";
  const inFlight = await callSend({
    body: { threadId: 41, body: "Still working", clientMessageId: id },
    reservation: { state: "in_progress", retryAfterMs: 31_200, message: { id: 88, client_message_id: id } },
  });
  assert.equal(inFlight.res.statusCode, 409);
  assert.equal(inFlight.json.error, "message_in_progress");
  assert.equal(inFlight.json.retryable, true);
  assert.equal(inFlight.res.headers["retry-after"], "32");
  assert.equal(inFlight.deliverCalls, 0);

  const unknown = await callSend({
    body: { threadId: 41, body: "Do not double email", clientMessageId: id },
    reservation: { state: "delivery_unknown", message: { id: 89, client_message_id: id } },
  });
  assert.equal(unknown.res.statusCode, 409);
  assert.equal(unknown.json.error, "delivery_unknown");
  assert.equal(unknown.json.retryable, false);
  assert.equal(unknown.json.manual, true);
  assert.equal(unknown.deliverCalls, 0, "ambiguous old email requires a human check, never a second provider call");

  const uncertain = await callSend({
    body: { threadId: 41, body: "Please reply", clientMessageId: id },
    delivery: { channel: "email", delivered: false },
  });
  assert.equal(uncertain.res.statusCode, 502);
  assert.equal(uncertain.json.error, "delivery_not_confirmed");
  assert.equal(uncertain.json.retryable, true);
  assert.equal(uncertain.trace.includes("complete"), false);
  assert.equal(uncertain.events.length, 0, "pending is not recorded as sent");
});

test("stale reservations retry safely, but email stops before Resend's 24-hour edge", async () => {
  const now = Date.parse("2026-08-09T18:00:00.000Z");
  const id = "b1d471ad-ed02-45ed-a625-1519bcdf9c5c";
  const base = {
    id: 501,
    thread_id: 41,
    direction: "outbound",
    body: "A durable reply",
    client_message_id: id,
    delivery_status: "pending",
    delivery_lease_token: "67e3f82c-c59c-4a44-a4b0-ea3113e58d01",
    delivery_attempts: 1,
    meta: { delivery: { status: "pending" } },
  };

  async function classify({ channel, firstAge, lastAge, status = "pending", text = base.body }) {
    const existing = {
      ...base,
      delivery_status: status,
      created_at: new Date(now - firstAge).toISOString(),
      delivery_first_attempt_at: new Date(now - firstAge).toISOString(),
      delivery_last_attempt_at: new Date(now - lastAge).toISOString(),
    };
    const patches = [];
    return withConnectStore({
      insertRow: async () => ({
        mode: "live_write_failed",
        error: { code: "23505", details: "connect_messages_thread_client_message_uidx (thread_id, client_message_id)" },
      }),
      select: async () => ({ ok: true, data: [existing] }),
      conditionalUpdate: async (_table, _key, _id, _where, patch) => {
        patches.push(patch);
        return { ok: true, updated: true, rows: [{ ...existing, ...patch }] };
      },
    }, async (connect) => ({
      result: await connect.reserveOutboundMessage({
        thread: { id: 41, channel },
        text,
        clientMessageId: id,
        nowMs: now,
      }),
      patches,
      resendWindow: connect.RESEND_IDEMPOTENCY_WINDOW_MS,
    }));
  }

  const young = await classify({ channel: "email", firstAge: 60_000, lastAge: 30_000 });
  assert.equal(young.result.state, "in_progress");
  assert.equal(young.patches.length, 0);

  const safeEmail = await classify({ channel: "email", firstAge: 22 * 60 * 60 * 1000, lastAge: 3 * 60 * 1000 });
  assert.equal(safeEmail.resendWindow, 23 * 60 * 60 * 1000);
  assert.equal(safeEmail.result.state, "reserved", "email can reuse the same provider key inside the guarded window");
  assert.equal(safeEmail.patches[0].delivery_status, undefined);

  const expiredEmail = await classify({ channel: "email", firstAge: 23 * 60 * 60 * 1000, lastAge: 3 * 60 * 1000 });
  assert.equal(expiredEmail.result.state, "delivery_unknown");
  assert.equal(expiredEmail.result.manual, true);
  assert.equal(expiredEmail.patches[0].delivery_status, "delivery_unknown");

  const queuedChannel = await classify({ channel: "chat", firstAge: 30 * 60 * 60 * 1000, lastAge: 3 * 60 * 1000 });
  assert.equal(queuedChannel.result.state, "reserved", "non-email queued delivery can reclaim a stale lease without a provider-window ambiguity");

  const completed = await classify({ channel: "chat", firstAge: 60_000, lastAge: 30_000, status: "completed" });
  assert.equal(completed.result.state, "completed");
  assert.equal(completed.patches.length, 0);
  const conflict = await classify({ channel: "chat", firstAge: 60_000, lastAge: 30_000, text: "Changed body" });
  assert.equal(conflict.result.state, "conflict");
  assert.equal(conflict.patches.length, 0);
});
