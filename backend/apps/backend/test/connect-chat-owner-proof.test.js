"use strict";

// WSS Connect live-chat owner proof.
//
// This suite treats the anonymous visitor credential as a one-thread bearer
// capability. It exercises the real signer/verifier and HTTP handlers while
// replacing only durable storage, outbound push, and Vercel lifecycle hooks.
// The browser half is verified from the exact HTML emitted by the mirror
// injector, including every-page coverage and the mobile/polling truth rules.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const tokenPath = path.resolve(__dirname, "../lib/connect-visitor-token.js");
const chatSharedPath = path.resolve(__dirname, "../lib/connect-chat.js");
const startPath = path.resolve(__dirname, "../api/connect/chat-start.js");
const postPath = path.resolve(__dirname, "../api/connect/chat-post.js");
const pollPath = path.resolve(__dirname, "../api/connect/chat-poll.js");
const widgetPath = path.resolve(__dirname, "../lib/mirror-engine/chat-widget.js");
const injectorPath = path.resolve(__dirname, "../lib/mirror-engine/content-inject.js");
const storePath = require.resolve("../lib/store.js");
const connectPath = require.resolve("../lib/connect.js");
const pushPath = require.resolve("../lib/connect-push.js");
const vercelFunctionsPath = require.resolve("@vercel/functions");

const SECRET = "visitor-owner-proof-secret-is-at-least-32-bytes";
const TOKEN_ENV = { CONNECT_VISITOR_TOKEN_SECRET: SECRET };
const ALPHA = "alpha-plumbing-tulsa";
const BETA = "beta-roofing-tulsa";
const NOW = Date.parse("2026-08-09T12:00:00.000Z");

function makeRes(initialHeaders = {}) {
  return {
    statusCode: 200,
    headers: Object.fromEntries(Object.entries(initialHeaders).map(([name, value]) => [String(name).toLowerCase(), value])),
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
    end(value) { this.body = value === undefined ? "" : String(value); return this; },
  };
}

function json(res) {
  return res.body ? JSON.parse(res.body) : {};
}

function request({ method = "GET", token = "", body, query, ip = "203.0.113.19", slug = ALPHA } = {}) {
  return {
    method,
    headers: {
      origin: `https://${slug}.wss-ai.com`,
      referer: `https://${slug}.wss-ai.com/contact`,
      ...(token ? { "x-connect-visitor-token": token } : {}),
    },
    body,
    query: query || {},
    socket: { remoteAddress: ip },
  };
}

function forgeVisitorToken(payload) {
  const segment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", SECRET).update(segment, "utf8").digest("base64url");
  return `${segment}.${signature}`;
}

function clearChatModules() {
  for (const file of [startPath, postPath, pollPath, chatSharedPath]) delete require.cache[file];
}

function withCacheMocks(entries, run) {
  const originals = new Map();
  for (const [id, exports] of entries) {
    originals.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  clearChatModules();
  return Promise.resolve()
    .then(run)
    .finally(() => {
      clearChatModules();
      for (const [id] of entries) {
        const prior = originals.get(id);
        if (prior) require.cache[id] = prior;
        else delete require.cache[id];
      }
    });
}

async function withVisitorSecret(run) {
  const prior = process.env.CONNECT_VISITOR_TOKEN_SECRET;
  process.env.CONNECT_VISITOR_TOKEN_SECRET = SECRET;
  try { return await run(); }
  finally {
    if (prior === undefined) delete process.env.CONNECT_VISITOR_TOKEN_SECRET;
    else process.env.CONNECT_VISITOR_TOKEN_SECRET = prior;
    delete require.cache[tokenPath];
  }
}

function chatHarness({ pushRejects = false } = {}) {
  const state = {
    nextMessageId: 900,
    ensureCalls: [],
    addCalls: [],
    touchCalls: [],
    pushCalls: [],
    events: [],
    selects: [],
    waits: [],
    threads: new Map([
      ["101", { id: 101, thread_key: `${ALPHA}:chat:fixture`, site_slug: ALPHA, channel: "chat", contact_name: "Website visitor", contact_info: "private-alpha@example.test", meta: { source: "site_widget", secret: "thread-secret" } }],
      ["202", { id: 202, thread_key: `${BETA}:chat:fixture`, site_slug: BETA, channel: "chat", contact_name: "Website visitor", contact_info: "+1 918 555 0202", meta: { source: "site_widget", secret: "beta-secret" } }],
    ]),
    messages: new Map([
      ["101", [
        { id: 11, thread_id: 101, direction: "inbound", body: "Could you help with a leak?", created_at: "2026-08-09T11:00:00.000Z", meta: { email: "private-alpha@example.test", phone: "+1 918 555 0101", secret: "message-secret" } },
        { id: 12, thread_id: 101, direction: "outbound", body: "Yes. We can help Tuesday morning.", created_at: "2026-08-09T11:01:00.000Z", meta: { delivery: { queued: true }, owner_email: "owner-alpha@example.test" } },
      ]],
      ["202", [{ id: 21, thread_id: 202, direction: "outbound", body: "BETA-ONLY-SECRET-BODY", created_at: "2026-08-09T11:02:00.000Z", meta: { secret: "beta-message-secret" } }]],
    ]),
  };

  const store = {
    async select(table, query = "") {
      const q = decodeURIComponent(String(query));
      state.selects.push({ table, query: q });
      if (table === "ghost_agency_dashboard_access") {
        const slug = /site_slug=eq\.([^&]+)/.exec(q)?.[1] || "";
        return { ok: true, data: [ALPHA, BETA].includes(slug) ? [{ site_slug: slug, job_id: `paid-${slug}`, business_name: slug === ALPHA ? "Alpha Plumbing" : "Beta Roofing" }] : [] };
      }
      if (table === "ghost_agency_prospects") return { ok: true, data: [] };
      if (table === "connect_threads") {
        const id = /id=eq\.([^&]+)/.exec(q)?.[1] || "";
        return { ok: true, data: state.threads.has(id) ? [state.threads.get(id)] : [] };
      }
      if (table === "connect_messages") {
        const id = /thread_id=eq\.([^&]+)/.exec(q)?.[1] || "";
        const after = Number(/id=gt\.([^&]+)/.exec(q)?.[1] || 0);
        return { ok: true, data: (state.messages.get(id) || []).filter((row) => Number(row.id) > after) };
      }
      return { ok: true, data: [] };
    },
    async insertRow(table, row) {
      if (table === "connect_threads") {
        const made = { id: 101, ...row };
        state.threads.set("101", made);
        state.ensureCalls.push(row);
        return { mode: "live_write", row: made };
      }
      if (table === "connect_messages") {
        const made = { id: ++state.nextMessageId, created_at: "2026-08-09T12:00:00.000Z", ...row };
        const id = String(row.thread_id);
        state.messages.set(id, [...(state.messages.get(id) || []), made]);
        state.addCalls.push({ threadId: row.thread_id, direction: row.direction, body: row.body, meta: row.meta });
        return { mode: "live_write", row: made };
      }
      return { mode: "live_write", row: { id: 1, ...row } };
    },
    async recordEvent(type, payload) { state.events.push({ type, payload }); return { mode: "live_write" }; },
    async event(entry) { state.events.push(entry); return { mode: "live_write" }; },
  };

  const connect = {
    async readBody(req) { return req.body && typeof req.body === "object" ? req.body : {}; },
    async ensureThread(input) {
      state.ensureCalls.push(input);
      const existing = state.threads.get("101");
      if (existing && existing.site_slug === input.siteSlug) return existing;
      const made = { id: 101, thread_key: input.threadKey, site_slug: input.siteSlug, channel: input.channel, contact_name: input.contactName || null, contact_info: input.contactInfo || null, subject: input.subject || null, meta: input.meta || null };
      state.threads.set("101", made);
      return made;
    },
    async addMessage(threadId, direction, body, meta) {
      const made = { id: ++state.nextMessageId, thread_id: Number(threadId), direction, body, meta, created_at: "2026-08-09T12:00:00.000Z" };
      const id = String(threadId);
      state.messages.set(id, [...(state.messages.get(id) || []), made]);
      state.addCalls.push({ threadId, direction, body, meta });
      return made;
    },
    async touchThread(threadId, patch) { state.touchCalls.push({ threadId, patch }); },
  };

  const push = {
    async sendConnectPush(input) {
      state.pushCalls.push(input);
      if (pushRejects) throw new Error("provider deliberately down in owner proof");
      return { attempted: 1, sent: 1, pruned: 0 };
    },
  };
  const lifecycle = {
    waitUntil(promise) {
      const settled = Promise.resolve(promise).catch(() => undefined);
      state.waits.push(settled);
    },
  };
  return { state, mocks: [[storePath, store], [connectPath, connect], [pushPath, push], [vercelFunctionsPath, lifecycle]] };
}

function mint(threadId = "101", siteSlug = ALPHA) {
  delete require.cache[tokenPath];
  const { signVisitorToken } = require(tokenPath);
  return signVisitorToken({ threadId, siteSlug, env: TOKEN_ENV });
}

async function invoke(handler, req, initialHeaders) {
  const res = makeRes(initialHeaders);
  await handler(req, res);
  return res;
}

test("visitor credentials have a finite 24-hour ceiling and a fail-closed finite-number guard", () => {
  delete require.cache[tokenPath];
  const {
    signVisitorToken,
    verifyVisitorToken,
    DEFAULT_VISITOR_TOKEN_TTL_MS,
    MAX_VISITOR_TOKEN_TTL_MS,
  } = require(tokenPath);

  assert.equal(DEFAULT_VISITOR_TOKEN_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(MAX_VISITOR_TOKEN_TTL_MS, 24 * 60 * 60 * 1000);
  const token = signVisitorToken({ threadId: "101", siteSlug: ALPHA, now: NOW, env: TOKEN_ENV });
  assert.ok(token, "a configured signer must mint a session");
  const valid = verifyVisitorToken(token, { now: NOW, env: TOKEN_ENV });
  assert.deepEqual(valid, { ok: true, threadId: "101", siteSlug: ALPHA, exp: NOW + DEFAULT_VISITOR_TOKEN_TTL_MS });
  assert.equal(verifyVisitorToken(token, { now: valid.exp - 1, env: TOKEN_ENV }).ok, true);
  assert.equal(verifyVisitorToken(token, { now: valid.exp, env: TOKEN_ENV }).reason, "expired");

  assert.equal(signVisitorToken({ threadId: "101", siteSlug: ALPHA, ttlMs: Infinity, now: NOW, env: TOKEN_ENV }), "");
  assert.equal(signVisitorToken({ threadId: "101", siteSlug: ALPHA, ttlMs: MAX_VISITOR_TOKEN_TTL_MS + 1, now: NOW, env: TOKEN_ENV }), "");
  for (const exp of [null, "not-a-number", NOW + 1000.5]) {
    const forged = forgeVisitorToken({ v: 1, threadId: "101", siteSlug: ALPHA, exp });
    assert.equal(verifyVisitorToken(forged, { now: NOW, env: TOKEN_ENV }).reason, "malformed");
  }
  const source = fs.readFileSync(tokenPath, "utf8");
  assert.match(source, /!Number\.isFinite\(exp\)/, "missing or non-finite expiry must never become a permanent token");
});

test("a visitor credential is bound to the exact thread and tenant; tampering is refused", () => {
  delete require.cache[tokenPath];
  const { signVisitorToken, verifyVisitorToken } = require(tokenPath);
  const token = signVisitorToken({ threadId: "101", siteSlug: ALPHA, ttlMs: 60_000, now: NOW, env: TOKEN_ENV });
  assert.equal(verifyVisitorToken(token, { threadId: "101", siteSlug: ALPHA, now: NOW, env: TOKEN_ENV }).ok, true);
  assert.equal(verifyVisitorToken(token, { threadId: "202", siteSlug: ALPHA, now: NOW, env: TOKEN_ENV }).reason, "binding_mismatch");
  assert.equal(verifyVisitorToken(token, { threadId: "101", siteSlug: BETA, now: NOW, env: TOKEN_ENV }).reason, "binding_mismatch");

  const [payload, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const changedThread = Buffer.from(JSON.stringify({ ...decoded, threadId: "202" }), "utf8").toString("base64url");
  const changedSlug = Buffer.from(JSON.stringify({ ...decoded, siteSlug: BETA }), "utf8").toString("base64url");
  assert.equal(verifyVisitorToken(`${changedThread}.${signature}`, { now: NOW, env: TOKEN_ENV }).reason, "bad_signature");
  assert.equal(verifyVisitorToken(`${changedSlug}.${signature}`, { now: NOW, env: TOKEN_ENV }).reason, "bad_signature");
});

test("the canonical 80-character tenant slug survives a visitor token exactly", () => {
  delete require.cache[tokenPath];
  const { signVisitorToken, verifyVisitorToken } = require(tokenPath);
  const boundarySlug = `a${"b".repeat(79)}`;
  assert.equal(boundarySlug.length, 80);
  const token = signVisitorToken({ threadId: "101", siteSlug: boundarySlug, ttlMs: 60_000, now: NOW, env: TOKEN_ENV });
  assert.ok(token);
  assert.deepEqual(
    verifyVisitorToken(token, { threadId: "101", siteSlug: boundarySlug, now: NOW, env: TOKEN_ENV }),
    { ok: true, threadId: "101", siteSlug: boundarySlug, exp: NOW + 60_000 },
  );
  assert.equal(
    signVisitorToken({ threadId: "101", siteSlug: `${boundarySlug}c`, ttlMs: 60_000, now: NOW, env: TOKEN_ENV }),
    "",
    "an over-limit slug is refused, never silently truncated into another tenant",
  );
});

test("an ordinary Connect reply to a site widget is truthfully delivered by visitor poll", async () => {
  delete require.cache[connectPath];
  const { deliverOutbound } = require(connectPath);
  assert.deepEqual(
    await deliverOutbound({ channel: "chat", meta: { source: "site_widget" } }, "We can help Tuesday."),
    { channel: "chat", delivered: true, via: "visitor_poll" },
  );
  const unrelated = await deliverOutbound({ channel: "chat", meta: { source: "another_chat_source" } }, "Hello");
  assert.equal(unrelated.delivered, false);
  assert.equal(unrelated.queued, true, "the truthful delivery upgrade is limited to the poll-backed site widget");
});

test("chat post and poll refuse missing, garbage, expired, and tampered visitor sessions before data access", async () => {
  await withVisitorSecret(async () => {
    const { state, mocks } = chatHarness();
    await withCacheMocks(mocks, async () => {
      const post = require(postPath);
      const poll = require(pollPath);
      const expired = forgeVisitorToken({ v: 1, threadId: "101", siteSlug: ALPHA, exp: Date.now() - 1 });
      const valid = mint();
      const [payload, signature] = valid.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      const changed = Buffer.from(JSON.stringify({ ...claims, threadId: "202" }), "utf8").toString("base64url");
      for (const token of ["", "garbage", expired, `${changed}.${signature}`]) {
        const before = state.selects.length;
        const postRes = await invoke(post, request({ method: "POST", token, body: { body: "hello", website: "" }, ip: `203.0.113.${40 + before}` }));
        const pollRes = await invoke(poll, request({ token, query: { after: "0" }, ip: `203.0.113.${80 + before}` }));
        assert.equal(postRes.statusCode, 401, `post refuses ${token ? "invalid" : "missing"} session`);
        assert.equal(pollRes.statusCode, 401, `poll refuses ${token ? "invalid" : "missing"} session`);
        assert.equal(json(postRes).error, "invalid_or_expired_session");
        assert.equal(json(pollRes).error, "invalid_or_expired_session");
        assert.equal(state.selects.length, before, "bad bearer data never reaches a durable read");
      }
      assert.equal(state.addCalls.length, 0);
    });
  });
});

test("visitor chat requires its exact mirror Origin and reflects only valid preflights", async () => {
  await withVisitorSecret(async () => {
    const { state, mocks } = chatHarness();
    await withCacheMocks(mocks, async () => {
      const start = require(startPath);
      const post = require(postPath);
      const poll = require(pollPath);
      const token = mint("101", ALPHA);

      const missing = request({ method: "POST", body: { slug: ALPHA, body: "hello" } });
      delete missing.headers.origin;
      assert.equal((await invoke(start, missing)).statusCode, 403);
      assert.equal((await invoke(start, request({ method: "POST", slug: BETA, body: { slug: ALPHA, body: "hello" } }))).statusCode, 403);
      assert.equal((await invoke(post, request({ method: "POST", token, slug: BETA, body: { body: "hello" } }))).statusCode, 403);
      assert.equal((await invoke(poll, request({ token, slug: BETA, query: { after: "0" } }))).statusCode, 403);
      assert.equal(state.addCalls.length, 0, "an Origin mismatch never writes a chat message");

      const goodPreflight = await invoke(start, request({ method: "OPTIONS", slug: ALPHA }));
      assert.equal(goodPreflight.statusCode, 204);
      assert.equal(goodPreflight.headers["access-control-allow-origin"], `https://${ALPHA}.wss-ai.com`);
      assert.match(goodPreflight.headers["access-control-allow-headers"], /x-connect-visitor-token/i);

      const badPreflight = request({ method: "OPTIONS", slug: ALPHA });
      badPreflight.headers.origin = "https://evil.example.test";
      const refused = await invoke(start, badPreflight, { "Access-Control-Allow-Origin": "*" });
      assert.equal(refused.statusCode, 204);
      assert.equal(refused.headers["access-control-allow-origin"], undefined);

      const vercel = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../vercel.json"), "utf8"));
      const globalApiHeaders = vercel.headers.find((rule) => rule.headers.some((header) => (
        header.key === "Access-Control-Allow-Origin" && header.value === "*"
      )));
      const globalApiMatcher = new RegExp(`^${globalApiHeaders.source}$`);
      for (const route of ["chat-start", "chat-post", "chat-poll"]) {
        assert.equal(globalApiMatcher.test(`/api/connect/${route}`), false, `${route} cannot inherit wildcard CORS`);
        assert.equal(globalApiMatcher.test(`/api/connect/${route}/`), false, `${route}/ cannot inherit wildcard CORS`);
      }
      assert.equal(globalApiMatcher.test("/api/connect/send"), true, "unrelated API CORS remains unchanged");
      assert.equal(globalApiMatcher.test("/api/connect/chat-start/extra"), true, "only the exact chat endpoint is excluded");
      assert.equal(globalApiMatcher.test("/api/connect/chat-poster"), true, "similarly named endpoints remain unchanged");
      assert.equal(globalApiMatcher.test("/api/admin/gallery-data"), true, "admin API CORS remains unchanged");
    });
  });
});

test("a valid visitor still gets 404 when its thread's durable tenant no longer matches", async () => {
  await withVisitorSecret(async () => {
    const { state, mocks } = chatHarness();
    state.threads.set("101", { ...state.threads.get("101"), site_slug: BETA });
    await withCacheMocks(mocks, async () => {
      const post = require(postPath);
      const poll = require(pollPath);
      const token = mint("101", ALPHA);
      const postRes = await invoke(post, request({ method: "POST", token, body: { body: "must not cross", website: "" } }));
      const pollRes = await invoke(poll, request({ token, query: { after: "0", thread: "202" } }));
      assert.equal(postRes.statusCode, 404);
      assert.equal(pollRes.statusCode, 404);
      assert.equal(json(postRes).error, "thread_not_found");
      assert.equal(json(pollRes).error, "thread_not_found");
      assert.equal(state.addCalls.length, 0);
      assert.doesNotMatch(`${postRes.body}\n${pollRes.body}`, /BETA-ONLY|beta-message-secret/);
    });
  });
});

test("poll returns only the session thread, exposes a strict safe allowlist, and includes an ordinary Connect reply", async () => {
  await withVisitorSecret(async () => {
    const { state, mocks } = chatHarness();
    await withCacheMocks(mocks, async () => {
      const poll = require(pollPath);
      const res = await invoke(poll, request({ token: mint("101", ALPHA), query: { after: "0", thread: "202", siteSlug: BETA } }));
      assert.equal(res.statusCode, 200, res.body);
      const payload = json(res);
      assert.equal(payload.ok, true);
      assert.deepEqual(payload.messages.map((row) => row.direction), ["inbound", "outbound"]);
      assert.match(payload.messages[1].body, /We can help Tuesday/, "the owner's normal Connect outbound row reaches the visitor poll");
      for (const message of payload.messages) {
        assert.deepEqual(Object.keys(message).sort(), ["body", "createdAt", "direction", "id"]);
      }
      assert.deepEqual(Object.keys(payload).sort(), ["cursor", "messages", "ok"]);
      assert.doesNotMatch(res.body, /private-alpha|owner-alpha|918.555|contact_info|thread_id|site_slug|meta|secret/i);
      assert.doesNotMatch(res.body, /BETA-ONLY-SECRET-BODY/);
      const messageRead = state.selects.find((entry) => entry.table === "connect_messages");
      assert.match(messageRead.query, /thread_id=eq\.101/);
      assert.doesNotMatch(messageRead.query, /202|beta-roofing/);
    });
  });
});

test("visitor posting is capped, tenant-scoped, and push failure cannot fail the accepted message", async () => {
  await withVisitorSecret(async () => {
    const { state, mocks } = chatHarness({ pushRejects: true });
    await withCacheMocks(mocks, async () => {
      const post = require(postPath);
      const longBody = "x".repeat(20_000);
      const tooLarge = await invoke(post, request({ method: "POST", token: mint(), body: JSON.stringify({ body: longBody, website: "" }), ip: "203.0.113.121" }));
      assert.equal(tooLarge.statusCode, 413, tooLarge.body);
      assert.equal(json(tooLarge).error, "request_too_large");
      assert.equal(state.addCalls.length, 0, "the 16 KiB envelope guard runs before any durable write");
      assert.equal(state.pushCalls.length, 0);

      const capped = await invoke(post, request({ method: "POST", token: mint(), body: { body: "x".repeat(3000), website: "" }, ip: "203.0.113.122" }));
      assert.equal(capped.statusCode, 200, capped.body);
      assert.equal(json(capped).status, "sent");
      assert.equal(state.addCalls.length, 1);
      assert.equal(Array.from(state.addCalls[0].body).length, 2000, "a legal envelope still receives the server-side field cap");
      assert.equal(state.addCalls[0].threadId, "101");
      assert.equal(state.addCalls[0].direction, "inbound");
      await Promise.all(state.waits);
      assert.equal(state.pushCalls.length, 1, "an accepted visitor message attempts one tenant push");
      assert.equal(state.pushCalls[0].siteSlug, ALPHA);
      assert.equal(state.pushCalls[0].threadId, "101");
      assert.doesNotMatch(JSON.stringify(state.pushCalls[0]), /private-alpha|918.555|example\.test/i);
    });
  });
});

test("start and post honeypots are silent successes and their burst guards eventually return 429", async () => {
  await withVisitorSecret(async () => {
    {
      const { state, mocks } = chatHarness();
      await withCacheMocks(mocks, async () => {
        const start = require(startPath);
        const trap = await invoke(start, request({ method: "POST", body: { slug: ALPHA, body: "spam", website: "filled" }, ip: "203.0.113.131" }));
        assert.equal(trap.statusCode, 200);
        assert.equal(json(trap).ok, true);
        assert.equal(state.ensureCalls.length, 0);
        assert.equal(state.addCalls.length, 0, "a honeypot success stores nothing");

        let limited = null;
        for (let i = 0; i < 100; i += 1) {
          const res = await invoke(start, request({ method: "POST", body: { slug: ALPHA, body: `message ${i}`, website: "" }, ip: "203.0.113.132" }));
          if (res.statusCode === 429) { limited = res; break; }
        }
        assert.ok(limited, "a public start endpoint must have a finite per-IP burst ceiling");
        assert.equal(json(limited).error, "rate_limited");
      });
    }

    {
      const { state, mocks } = chatHarness();
      await withCacheMocks(mocks, async () => {
        const post = require(postPath);
        const token = mint();
        const trap = await invoke(post, request({ method: "POST", token, body: { body: "spam", website: "filled" }, ip: "203.0.113.133" }));
        assert.equal(trap.statusCode, 200);
        assert.equal(json(trap).ok, true);
        assert.equal(state.addCalls.length, 0);

        let limited = null;
        for (let i = 0; i < 150; i += 1) {
          const res = await invoke(post, request({ method: "POST", token, body: { body: `follow-up ${i}`, website: "" }, ip: "203.0.113.134" }));
          if (res.statusCode === 429) { limited = res; break; }
        }
        assert.ok(limited, "a public post endpoint must have a finite per-IP/session burst ceiling");
        assert.equal(json(limited).error, "rate_limited");
      });
    }
  });
});

test("chat start makes an ordinary chat thread/message and returns only a one-thread session", async () => {
  await withVisitorSecret(async () => {
    const { state, mocks } = chatHarness();
    // Force ensureThread down its create-shaped path rather than reusing the
    // fixture. The handler still owns the tenant; no routing field is mocked.
    state.threads.delete("101");
    await withCacheMocks(mocks, async () => {
      const start = require(startPath);
      const oversized = "Our water heater stopped. " + "x".repeat(3000);
      const res = await invoke(start, request({ method: "POST", body: { slug: ALPHA, body: oversized, website: "", siteSlug: BETA, threadId: "202" }, ip: "203.0.113.141" }));
      assert.equal(res.statusCode, 200, res.body);
      const payload = json(res);
      assert.equal(payload.ok, true);
      assert.equal(payload.status, "sent");
      assert.deepEqual(Object.keys(payload).sort(), ["messageId", "ok", "status", "threadId", "token"]);
      assert.equal(String(payload.threadId), "101");
      assert.equal(state.ensureCalls.length, 1);
      assert.equal(state.ensureCalls[0].siteSlug || state.ensureCalls[0].site_slug, ALPHA);
      assert.equal(state.ensureCalls[0].channel, "chat");
      assert.match(JSON.stringify(state.ensureCalls[0]), /site_widget/);
      assert.equal(state.addCalls.length, 1);
      assert.equal(state.addCalls[0].direction, "inbound");
      assert.equal(Array.from(state.addCalls[0].body).length, 2000, "start enforces the same server-side body cap as post");
      assert.match(state.addCalls[0].body, /^Our water heater stopped\./);
      const { verifyVisitorToken } = require(tokenPath);
      assert.equal(verifyVisitorToken(payload.token, { threadId: "101", siteSlug: ALPHA, env: TOKEN_ENV }).ok, true);
      assert.equal(verifyVisitorToken(payload.token, { threadId: "202", siteSlug: ALPHA, env: TOKEN_ENV }).reason, "binding_mismatch");
      assert.doesNotMatch(res.body, /private-alpha|owner|phone|email|contact|secret|beta-roofing/i);
    });
  });
});

test("the widget is valid self-contained JavaScript with honest relay copy and exact polling clocks", () => {
  delete require.cache[widgetPath];
  const {
    buildChatWidget,
    resolveChatWidgetConfig,
    OPEN_POLL_MS,
    CLOSED_POLL_MS,
    IDLE_STOP_MS,
  } = require(widgetPath);
  assert.equal(OPEN_POLL_MS, 6000);
  assert.equal(CLOSED_POLL_MS, 30000);
  assert.equal(IDLE_STOP_MS, 600000);

  const resolved = resolveChatWidgetConfig({
    slug: ALPHA,
    facts: { business_name: "Alpha Plumbing", phone: "(918) 555-0101" },
    brand: { primary: "#173f38", accent: "#df9f54" },
  });
  const config = resolved && resolved.config ? resolved.config : resolved;
  const html = buildChatWidget(config);
  for (const id of ["wss-chat-root", "wss-chat-launcher", "wss-chat-panel", "wss-chat-messages", "wss-chat-form", "wss-chat-input", "wss-chat-send", "wss-chat-status", "wss-chat-config"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `${id} is a stable hook in the emitted widget`);
  }
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2, "the config stamp and behavior script both ship inline");
  for (const [, attrs, source] of scripts) {
    if (/application\/json/i.test(attrs)) continue;
    assert.doesNotThrow(() => new vm.Script(source), "the emitted inline widget script parses");
  }
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/i, "an injected business site never depends on a CDN");
  // TRUTH LAW, updated 2026-08-12 (owner directive + lib/connect-ai-takeover.js):
  // the bubble is now answered by Riley after a human-first takeover window, so
  // the trigger MAY name Riley and MUST disclose that Riley is AI (SB 243). What
  // stays forbidden is a PRESENCE or READ-RECEIPT claim this async relay cannot
  // support — the widget never says a message was seen, that someone is typing,
  // or that anyone is "online". The delivery state still says only what a push
  // notification can support.
  assert.doesNotMatch(html, /\b(?:seen|typing)\b/i, "no read-receipt or typing-presence claim");
  assert.doesNotMatch(html, /\b(?:online now|is online|we(?:'| a)re online|currently online)\b/i, "no live-presence claim");
  assert.match(html, /\bAI\b/, "Riley is disclosed as AI on the trigger (SB 243)");
  assert.match(html, /they(?:'|’|&(?:#39|apos);)ll be notified/i, "the delivery state says only what push can support");
  assert.match(html, /6000/);
  assert.match(html, /30000/);
  assert.match(html, /600000/);
});

test("the chat panel stays inside 375/390px viewports and clears existing fixed CTAs", () => {
  delete require.cache[widgetPath];
  const { buildChatWidget, resolveChatWidgetConfig } = require(widgetPath);
  const resolved = resolveChatWidgetConfig({ slug: ALPHA, facts: { business_name: "Alpha Plumbing" } });
  const html = buildChatWidget(resolved && resolved.config ? resolved.config : resolved);
  assert.match(html, /@media\s*\(\s*max-width\s*:\s*480px\s*\)/i);
  assert.match(html, /width\s*:\s*calc\(100vw\s*-\s*20px\)/i, "10px gutters bound the panel at both 375px and 390px");
  assert.match(html, /#wss-chat-root\{right:max\(10px,env\(safe-area-inset-right\)\)/i, "the 370px panel plus its 10px right gutter fits a 390px viewport");
  assert.match(html, /env\(safe-area-inset-bottom/i);
  assert.match(html, /--wss-chat-clear/i, "the widget measures/accepts clearance above the site's own CTA instead of covering it");
  assert.match(html, /width\s*:\s*min\(380px,calc\(100vw\s*-\s*32px\)\)/i, "desktop styling is viewport-bounded before the mobile override too");
});

test("content injection puts one branded widget on every HTML page and reports the emitted bytes", () => {
  delete require.cache[injectorPath];
  const { inject } = require(injectorPath);
  const result = inject({
    files: {
      "index.html": Buffer.from("<html><body><main>home</main></body></html>"),
      "about.html": Buffer.from("<html><body><main>about</main></body></html>"),
      "service/drains.html": Buffer.from("<html><body><main>drains</main></body></html>"),
      "asset.txt": Buffer.from("not html"),
    },
    slug: ALPHA,
    facts: { business_name: "Alpha Plumbing", phone: "(918) 555-0101", industry: "plumbing", city: "Tulsa", state: "OK" },
    content: { services: [{ name: "Drain cleaning" }] },
    brand: { primary: "#173f38", accent: "#df9f54" },
  });
  assert.equal(result.report.chat_widget.present, true);
  const htmlPages = Object.keys(result.files).filter((name) => /\.html$/i.test(name));
  assert.equal(htmlPages.length, 4, "the three input pages plus the injector's real generated 404 are all chat surfaces");
  assert.ok(htmlPages.includes("404.html"));
  assert.equal(result.report.chat_widget.pages, htmlPages.length);
  assert.ok(result.report.chat_widget.bytes > 1000);
  for (const page of htmlPages) {
    const html = result.files[page].toString("utf8");
    assert.equal((html.match(/id=["']wss-chat-root["']/g) || []).length, 1, `${page} gets exactly one widget`);
    assert.match(html, /Alpha Plumbing/);
    assert.match(html, new RegExp(ALPHA));
  }
  assert.equal(result.files["asset.txt"].toString("utf8"), "not html");
});
