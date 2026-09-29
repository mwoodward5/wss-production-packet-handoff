"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const connectPath = require.resolve("../lib/connect");
const storePath = require.resolve("../lib/store");
const handlerPath = require.resolve("../api/connect/threads");

let scope = { mode: "tenant", siteSlug: "alpha" };
let reads = [];
let selectImpl = async () => ({ ok: true, data: [] });

require.cache[connectPath] = {
  id: connectPath,
  filename: connectPath,
  loaded: true,
  exports: { resolveConnectScope: () => scope },
};
require.cache[storePath] = {
  id: storePath,
  filename: storePath,
  loaded: true,
  exports: {
    select: async (table, query) => {
      reads.push({ table, query: String(query) });
      return selectImpl(table, String(query));
    },
  },
};
delete require.cache[handlerPath];
const handler = require(handlerPath);

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value) { this.body = value === undefined ? "" : String(value); },
  };
}

async function call({ method = "GET", query = {}, headers = { "x-connect-token": "test" } } = {}) {
  const req = { method, query, headers };
  const res = makeRes();
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, raw: res.body, json: JSON.parse(res.body || "{}") };
}

function params(query) {
  return new URLSearchParams(query);
}

function reset() {
  scope = { mode: "tenant", siteSlug: "alpha" };
  reads = [];
  selectImpl = async () => ({ ok: true, data: [] });
}

test.beforeEach(reset);

test("tenant summary uses only the signed scope and post-filters malicious foreign rows and messages", async () => {
  const threads = [
    {
      id: 1,
      site_slug: "alpha",
      channel: "email",
      contact_name: "  Alice <img src=x onerror=alert(1)>  ",
      contact_info: "alpha@example.test",
      meta: { provider_id: "alpha-provider-secret" },
      unread: false,
      last_message_at: "2026-08-11T11:00:00Z",
    },
    {
      id: 2,
      site_slug: "alpha",
      channel: "chat",
      contact_name: "SECOND PRIVATE NAME",
      last_message_at: "2026-08-10T10:30:00Z",
    },
    {
      id: 99,
      site_slug: "beta",
      channel: "email",
      contact_name: "FOREIGN PRIVATE NAME",
      contact_info: "foreign@example.test",
      last_message_at: "2026-08-12T12:00:00Z",
    },
  ];
  const messages = [
    { id: 11, thread_id: 1, direction: "inbound", body: "  <b>Need</b>\n a   quote.  ", created_at: "2026-08-11T10:00:00Z" },
    { id: 21, thread_id: 2, direction: "inbound", body: "Second lead question", created_at: "2026-08-10T10:00:00Z" },
    { id: 22, thread_id: 2, direction: "outbound", delivery_status: "completed", created_at: "2026-08-10T10:30:00Z" },
    { id: 990, thread_id: 99, direction: "inbound", body: "FOREIGN MESSAGE SECRET", created_at: "2026-08-12T12:00:00Z" },
  ];

  selectImpl = async (table, query) => {
    const parsed = params(query);
    if (table === "connect_threads") {
      assert.equal(
        parsed.get("select"),
        "id,site_slug,channel,contact_name,contact_info,subject,unread,last_message_at,created_at,meta",
        "tenant reads the inbox fields plus meta (distilled server-side, stripped from the wire)",
      );
      assert.equal(parsed.get("site_slug"), "eq.alpha", "the DB predicate comes from the signed scope");
      assert.equal(parsed.get("order"), "last_message_at.desc,id.desc");
      return { ok: true, data: threads };
    }
    assert.equal(table, "connect_messages");
    assert.equal(parsed.get("thread_id"), "in.(1,2)", "only post-filtered owned numeric ids are read");
    assert.equal(parsed.get("select"), "id,thread_id,direction,body,delivery_status,created_at", "only the safe activity body plus reply-state fields are fetched");
    return { ok: true, data: messages };
  };

  const result = await call({ query: { slug: "beta" } });
  assert.equal(result.status, 200);
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.json.scope, "tenant");
  assert.deepEqual(result.json.threads.map((thread) => thread.id), [1, 2]);
  assert.equal(result.json.summary.newLeads.count, 2);
  assert.equal(result.json.summary.unrepliedCount, 1);
  assert.deepEqual(result.json.summary.recentLeads.map((lead) => lead.threadId), ["1", "2"]);
  assert.equal(result.json.summary.recentLeads[0].name, "Alice");
  assert.equal(result.json.summary.recentLeads[0].firstLine, "Need a quote.");
  assert.equal(result.json.summary.recentLeads[0].needsReply, true);
  assert.equal(result.json.summary.recentLeads[1].needsReply, false);
  assert.doesNotMatch(result.raw, /FOREIGN PRIVATE NAME|foreign@example|FOREIGN MESSAGE SECRET/);

  const safeSummary = JSON.stringify(result.json.summary);
  assert.doesNotMatch(safeSummary, /alpha@example|provider-secret|<img|<b>/);
  assert.deepEqual(Object.keys(result.json.summary.recentLeads[0]).sort(), [
    "channel", "createdAt", "firstLine", "lastMessageAt", "name", "needsReply", "threadId",
  ]);
  // Raw meta never reaches the wire — the card fields are the distillate.
  assert.doesNotMatch(result.raw, /provider-secret/);
});

test("the lead card fields: captured phone tappable, what they asked, needs reply — meta stripped", async () => {
  reset();
  const threads = [
    {
      id: 7,
      site_slug: "alpha",
      channel: "chat",
      contact_name: "Dana",
      contact_info: null,
      // What the assistant's promoteLead actually writes (lib/connect-ai-takeover.js).
      meta: { lead: { name: "Dana", phone: "(503) 555-0142", capturedBy: "connect_ai" }, source: "site_widget" },
      unread: true,
      last_message_at: "2026-08-12T10:05:00Z",
    },
    {
      id: 8,
      site_slug: "alpha",
      channel: "chat",
      contact_name: "Website visitor",
      // contact_info alone, classified: an email is not a phone.
      contact_info: "gutters@example.test",
      unread: false,
      last_message_at: "2026-08-11T09:00:00Z",
    },
  ];
  const messages = [
    { id: 71, thread_id: 7, direction: "inbound", body: "Do you work on heat pumps, and what are your Saturday hours?", created_at: "2026-08-12T10:00:00Z" },
    { id: 81, thread_id: 8, direction: "inbound", body: "Gutter quote please", created_at: "2026-08-11T08:00:00Z" },
    { id: 82, thread_id: 8, direction: "outbound", delivery_status: "completed", created_at: "2026-08-11T09:00:00Z" },
  ];
  selectImpl = async (table) => (table === "connect_threads" ? { ok: true, data: threads } : { ok: true, data: messages });

  const result = await call();
  assert.equal(result.status, 200);
  const [first, second] = result.json.threads;
  assert.equal(first.contact_phone, "(503) 555-0142", "the captured phone rides the thread, tappable");
  assert.equal(first.first_line, "Do you work on heat pumps, and what are your Saturday hours?");
  assert.equal(first.needs_reply, true);
  assert.equal(first.meta, undefined, "raw meta stays server-side");
  assert.equal(second.contact_email, "gutters@example.test");
  assert.equal(second.contact_phone, "", "an email address is never dressed as a phone number");
  assert.equal(second.needs_reply, false, "an answered lead is not shouted about");
});

test("recent activity text is normalized, clipped, and has honest fallbacks", () => {
  const long = `  ${"word ".repeat(80)}\n<script>bad()</script>  `;
  const summary = handler._private.buildTenantSummary(
    [
      { id: 1, site_slug: "alpha", contact_name: "\n\t", channel: "chat" },
      { id: 2, site_slug: "alpha", contact_name: `  ${"N".repeat(100)}  `, channel: "email" },
    ],
    [
      { id: 11, thread_id: 1, direction: "inbound", body: "\r\n", created_at: "2026-08-11T10:00:00Z" },
      { id: 21, thread_id: 2, direction: "inbound", body: long, created_at: "2026-08-11T11:00:00Z" },
    ],
    Date.parse("2026-08-12T18:00:00Z"),
  );
  const fallback = summary.recentLeads.find((lead) => lead.threadId === "1");
  const clipped = summary.recentLeads.find((lead) => lead.threadId === "2");
  assert.equal(fallback.name, "Website visitor");
  assert.equal(fallback.firstLine, "New website message");
  assert.equal(clipped.name.length, 80);
  assert.ok(clipped.firstLine.length > 0 && clipped.firstLine.length <= 180);
  assert.doesNotMatch(clipped.firstLine, /[\r\n\t<>]/);
  assert.equal(clipped.firstLine, clipped.firstLine.trim());
});

test("lead math uses the first inbound and UTC Monday; unread never means unreplied", () => {
  const threads = [1, 2, 3, 4, 5, 6, 7].map((id) => ({
    id,
    site_slug: "alpha",
    channel: "email",
    unread: id % 2 === 0,
    last_message_at: `2026-08-${String(id + 3).padStart(2, "0")}T12:00:00Z`,
  }));
  const messages = [
    { id: 11, thread_id: 1, direction: "inbound", created_at: "2026-08-10T00:00:00Z" },
    { id: 21, thread_id: 2, direction: "inbound", created_at: "2026-08-03T09:00:00Z" },
    { id: 22, thread_id: 2, direction: "outbound", delivery_status: "pending", created_at: "2026-08-03T09:01:00Z" },
    { id: 31, thread_id: 3, direction: "inbound", created_at: "2026-08-09T23:59:59Z" },
    { id: 32, thread_id: 3, direction: "outbound", delivery_status: "delivery_unknown", created_at: "2026-08-10T00:00:01Z" },
    { id: 41, thread_id: 4, direction: "inbound", created_at: "2026-08-02T12:00:00Z" },
    { id: 42, thread_id: 4, direction: "outbound", delivery_status: "completed", created_at: "2026-08-02T12:01:00Z" },
    { id: 51, thread_id: 5, direction: "inbound", created_at: "2026-07-20T12:00:00Z" },
    { id: 52, thread_id: 5, direction: "outbound", delivery_status: null, created_at: "2026-07-20T12:01:00Z" },
    { id: 61, thread_id: 6, direction: "system", created_at: "2026-08-11T12:00:00Z" },
    { id: 62, thread_id: 6, direction: "outbound", delivery_status: "completed", created_at: "2026-08-11T12:01:00Z" },
    { id: 71, thread_id: 7, direction: "outbound", delivery_status: "completed", created_at: "2026-08-11T09:00:00Z" },
    { id: 72, thread_id: 7, direction: "inbound", created_at: "2026-08-11T10:00:00Z" },
  ];

  const summary = handler._private.buildTenantSummary(threads, messages, Date.parse("2026-08-12T18:00:00Z"));
  assert.deepEqual(summary.newLeads, {
    count: 6,
    thisWeek: 2,
    previousWeek: 2,
    changeVsPreviousWeek: 0,
    weekStartedAt: "2026-08-10T00:00:00.000Z",
  });
  assert.equal(summary.unrepliedCount, 2, "only threads with no later outbound attempt need a reply");
  assert.equal(summary.recentLeads.find((lead) => lead.threadId === "1").needsReply, true, "unread=false does not erase an unreplied lead");
  assert.equal(summary.recentLeads.find((lead) => lead.threadId === "2").needsReply, false, "pending suppresses a duplicate reply action");
  assert.equal(summary.recentLeads.find((lead) => lead.threadId === "3").needsReply, false, "delivery_unknown suppresses a duplicate reply action");
  assert.equal(summary.recentLeads.some((lead) => lead.threadId === "6"), false, "no inbound means no new lead");
  assert.equal(summary.recentLeads.find((lead) => lead.threadId === "7").needsReply, true, "an outbound before the newest inbound is not a reply");
});

test("tenant reads paginate without turning a full page into a silent total", async () => {
  const allThreads = Array.from({ length: 205 }, (_, index) => ({
    id: index + 1,
    site_slug: "alpha",
    channel: "chat",
    last_message_at: "2026-08-11T00:00:00Z",
  }));
  const threadOffsets = [];
  const messageChunks = [];
  selectImpl = async (table, query) => {
    const parsed = params(query);
    if (table === "connect_threads") {
      const offset = Number(parsed.get("offset"));
      const limit = Number(parsed.get("limit"));
      threadOffsets.push(offset);
      return { ok: true, data: allThreads.slice(offset, offset + limit) };
    }
    messageChunks.push(parsed.get("thread_id"));
    return { ok: true, data: [] };
  };

  const result = await call();
  assert.equal(result.status, 200);
  assert.equal(result.json.threads.length, 205);
  assert.deepEqual(threadOffsets, [0, 200]);
  assert.equal(messageChunks.length, 3, "owned ids are read in bounded chunks");
  assert.equal(result.json.summary.newLeads.count, 0, "a successful empty message source is an honest zero");
});

test("full/admin scope preserves the original thread response and gets no customer summary", async () => {
  scope = { mode: "full" };
  const raw = [{ id: 88, site_slug: "any", contact_info: "operator-visible@example.test" }];
  selectImpl = async (table, query) => {
    assert.equal(table, "connect_threads");
    assert.equal(query, "order=last_message_at.desc&limit=200");
    return { ok: true, data: raw };
  };

  const result = await call();
  assert.equal(result.status, 200);
  assert.equal(result.json.scope, "full");
  assert.deepEqual(result.json.threads, raw);
  assert.equal(Object.hasOwn(result.json, "summary"), false);
  assert.equal(reads.length, 1);
});

test("non-GET methods return 405 before auth or data reads", async () => {
  scope = null;
  const result = await call({ method: "POST", headers: {} });
  assert.equal(result.status, 405);
  assert.equal(result.json.error, "method_not_allowed");
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(reads.length, 0);
});

test("missing authentication returns 401 before data reads", async () => {
  scope = null;
  const result = await call({ headers: {} });
  assert.equal(result.status, 401);
  assert.equal(result.json.error, "unauthorized");
  assert.equal(reads.length, 0);
});

test("thread source failures return 503 instead of a false zero", async () => {
  selectImpl = async () => ({ ok: false, mode: "live_select_failed", data: [] });
  const result = await call();
  assert.equal(result.status, 503);
  assert.deepEqual(result.json, { ok: false, error: "source_unavailable" });
  assert.equal(Object.hasOwn(result.json, "summary"), false);
});

test("message source failures return 503 instead of a partial summary", async () => {
  selectImpl = async (table) => table === "connect_threads"
    ? { ok: true, data: [{ id: 1, site_slug: "alpha", channel: "email" }] }
    : { ok: false, mode: "live_select_failed", data: [] };
  const result = await call();
  assert.equal(result.status, 503);
  assert.equal(Object.hasOwn(result.json, "summary"), false);
  assert.equal(Object.hasOwn(result.json, "threads"), false);
});

test("the tenant thread cap fails closed after probing one row beyond it", async () => {
  selectImpl = async (table, query) => {
    assert.equal(table, "connect_threads");
    const parsed = params(query);
    const offset = Number(parsed.get("offset"));
    const limit = Number(parsed.get("limit"));
    return {
      ok: true,
      data: Array.from({ length: limit }, (_, index) => ({
        id: offset + index + 1,
        site_slug: "alpha",
        channel: "chat",
      })),
    };
  };

  const result = await call();
  assert.equal(result.status, 503);
  assert.equal(result.json.error, "source_unavailable");
  assert.equal(reads.length, 6, "five 200-row pages plus a one-row truncation probe");
});

test("the tenant message cap fails closed instead of publishing a partial lead total", async () => {
  selectImpl = async (table, query) => {
    if (table === "connect_threads") {
      return { ok: true, data: [{ id: 1, site_slug: "alpha", channel: "chat" }] };
    }
    const parsed = params(query);
    const offset = Number(parsed.get("offset"));
    const limit = Number(parsed.get("limit"));
    return {
      ok: true,
      data: Array.from({ length: limit }, (_, index) => ({
        id: offset + index + 1,
        thread_id: 1,
        direction: "inbound",
        body: "bounded fixture",
        created_at: "2026-08-11T00:00:00Z",
      })),
    };
  };

  const result = await call();
  assert.equal(result.status, 503);
  assert.equal(result.json.error, "source_unavailable");
  assert.equal(reads.filter((read) => read.table === "connect_messages").length, 21);
});
