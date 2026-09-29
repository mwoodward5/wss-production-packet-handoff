"use strict";

// test/connect-assistant-settings.test.js — the owner's own switches for the
// bubble on his own site, and the activity view under them.
//
// Two things are under test and they fail differently:
//
//   1. SCOPE. /api/connect/assistant must take the slug from the SIGNED TOKEN
//      and nowhere else. A tenant naming another business's slug gets 404 —
//      the same answer as a slug that was never real — so this endpoint cannot
//      be walked as a customer directory. This is the enforcement in
//      api/connect/send.js:88, applied to a resource that has no thread id to
//      hide behind.
//
//   2. TRUTH. lib/connect-assistant-activity.js counts rows or it reports
//      nothing. A read that failed, or a window that was truncated, must come
//      back available:false with EMPTY counts — never a zero, because a zero
//      the owner reads is a claim we made about his business.
//
// The real resolveConnectScope/verifyScopeToken run here. Only the store reads
// and writes are stubbed.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CONNECT_APP_TOKEN = "test-assistant-secret-abc";

const store = require("../lib/store");
const { signScopeToken } = require("../lib/dashboard-link");
const { readAssistantActivity, LIMITS } = require("../lib/connect-assistant-activity");

const NOW = Date.parse("2026-08-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// lib/connect-assistant-activity.js
// ---------------------------------------------------------------------------

function aiMessage(id, threadId, body, atMs, extra = {}) {
  return {
    id,
    thread_id: threadId,
    body,
    created_at: iso(atMs),
    meta: { source: "ai_assistant", state: "sent", delivered: "model", ...extra },
  };
}

function selectFrom({ threads = [], messages = [], fail = "" } = {}) {
  return async (table, query) => {
    if (fail === table) return { ok: false, mode: "live_select_failed", data: [] };
    if (table === "connect_threads") return { ok: true, data: threads };
    if (table === "connect_messages") {
      // Mirror what PostgREST would do with the filters the caller sent, so a
      // test cannot pass by ignoring a filter the real store would honour.
      const wantsSent = /meta->>state=eq\.sent/.test(String(query));
      const rows = messages.filter((m) => (wantsSent ? m.meta && m.meta.state === "sent" : true));
      return { ok: true, data: rows };
    }
    return { ok: true, data: [] };
  };
}

test("activity counts only replies the assistant actually SENT, inside the week", async () => {
  const threads = [{ id: 1, contact_name: "Dana", meta: {}, last_message_at: iso(NOW) }];
  const messages = [
    aiMessage(10, 1, "We're open Saturday 7am to 3pm.", NOW - 2 * DAY),
    aiMessage(11, 1, "Yes, we service heat pumps.", NOW - 6 * DAY),
    aiMessage(12, 1, "This one is older than the window.", NOW - 9 * DAY),
    // A reservation is not a reply. It must not be counted and must not be shown.
    { id: 13, thread_id: 1, body: "…", created_at: iso(NOW - DAY), meta: { source: "ai_assistant", state: "reserved" } },
    // A human's reply is the owner's own work, not the assistant's.
    { id: 14, thread_id: 1, body: "Owner typed this.", created_at: iso(NOW - DAY), meta: {} },
  ];
  const out = await readAssistantActivity("alpha-site", { select: selectFrom({ threads, messages }), now: () => NOW });
  assert.equal(out.available, true);
  assert.equal(out.week.answered, 2, "only the two SENT replies inside seven days");
  assert.equal(out.replies.length, 3, "the older sent reply is still shown, it is just not counted this week");
  assert.equal(out.replies[0].body, "We're open Saturday 7am to 3pm.", "newest first");
  assert.equal(out.replies[0].who, "Dana");
  assert.equal(out.replies[0].handedOver, false);
  assert.ok(!out.replies.some((r) => r.body === "Owner typed this."), "a human reply is never shown as the assistant's");
});

test("a handoff is reported as a handoff, not as an answer", async () => {
  const threads = [{ id: 1, contact_name: "", meta: {}, last_message_at: iso(NOW) }];
  const messages = [aiMessage(10, 1, "I'll pass this to the team.", NOW - DAY, { delivered: "handoff" })];
  const out = await readAssistantActivity("alpha-site", { select: selectFrom({ threads, messages }), now: () => NOW });
  assert.equal(out.replies[0].handedOver, true);
  assert.equal(out.replies[0].who, "Website visitor");
});

test("only leads the ASSISTANT captured, inside the week, are claimed", async () => {
  const threads = [
    { id: 1, contact_name: "A", meta: { lead: { capturedBy: "ai_assistant", capturedAt: iso(NOW - DAY) } }, last_message_at: iso(NOW) },
    { id: 2, contact_name: "B", meta: { lead: { capturedBy: "ai_assistant", capturedAt: iso(NOW - 30 * DAY) } }, last_message_at: iso(NOW) },
    { id: 3, contact_name: "C", meta: { lead: { capturedBy: "owner", capturedAt: iso(NOW - DAY) } }, last_message_at: iso(NOW) },
    { id: 4, contact_name: "D", meta: {}, last_message_at: iso(NOW) },
  ];
  const out = await readAssistantActivity("alpha-site", { select: selectFrom({ threads, messages: [] }), now: () => NOW });
  assert.equal(out.week.leadsCaptured, 1, "old ones, owner-captured ones and unmarked ones are not ours to claim");
});

test("no threads at all is a MEASURED zero, not an absent answer", async () => {
  const out = await readAssistantActivity("alpha-site", { select: selectFrom({}), now: () => NOW });
  assert.equal(out.available, true);
  assert.equal(out.week.answered, 0);
  assert.equal(out.week.leadsCaptured, 0);
  assert.deepEqual(out.replies, []);
});

test("a failed thread read yields NO counts — never a zero", async () => {
  const out = await readAssistantActivity("alpha-site", { select: selectFrom({ fail: "connect_threads" }), now: () => NOW });
  assert.equal(out.available, false);
  assert.equal(out.reason, "threads_unreadable");
  assert.equal(out.week, null, "a zero here would be a number we invented");
  assert.deepEqual(out.replies, []);
});

test("a failed message read yields NO counts even though the threads were readable", async () => {
  const threads = [{ id: 1, contact_name: "A", meta: {}, last_message_at: iso(NOW) }];
  const out = await readAssistantActivity("alpha-site", {
    select: selectFrom({ threads, fail: "connect_messages" }),
    now: () => NOW,
  });
  assert.equal(out.available, false);
  assert.equal(out.reason, "messages_unreadable");
  assert.equal(out.week, null);
});

test("a truncated window refuses rather than reporting a count of a partial read", async () => {
  const threads = [];
  for (let i = 1; i <= LIMITS.threads + 1; i += 1) {
    threads.push({ id: i, contact_name: "x", meta: {}, last_message_at: iso(NOW) });
  }
  const out = await readAssistantActivity("alpha-site", { select: selectFrom({ threads }), now: () => NOW });
  assert.equal(out.available, false);
  assert.equal(out.reason, "threads_truncated");
  assert.equal(out.week, null);
});

test("a throwing store is an absent answer, not an exception", async () => {
  const out = await readAssistantActivity("alpha-site", {
    select: async () => { throw new Error("boom"); },
    now: () => NOW,
  });
  assert.equal(out.available, false);
  assert.equal(out.week, null);
});

test("an invalid slug never reaches the store", async () => {
  let touched = false;
  const out = await readAssistantActivity("NOT A SLUG", {
    select: async () => { touched = true; return { ok: true, data: [] }; },
    now: () => NOW,
  });
  assert.equal(out.available, false);
  assert.equal(out.reason, "invalid_site_slug");
  assert.equal(touched, false);
});

// ---------------------------------------------------------------------------
// api/connect/assistant.js — scope
// ---------------------------------------------------------------------------

const SETTINGS_ROWS = {
  alpha: {
    site_slug: "alpha",
    ai_chat_enabled: true,
    takeover_seconds: 30,
    custom_qa: [{ question: "Free quotes?", answer: "Yes, always." }],
    booking_url: null,
    greeting: null,
    updated_at: iso(NOW),
  },
  beta: {
    site_slug: "beta",
    ai_chat_enabled: false,
    takeover_seconds: 120,
    custom_qa: [{ question: "BETA-ONLY-SECRET-QUESTION", answer: "BETA-ONLY-SECRET-ANSWER" }],
    booking_url: null,
    greeting: null,
    updated_at: iso(NOW),
  },
};

// lib/connect-site-settings.js destructures `upsertRow` off the store at
// require time, so a later reassignment of store.upsertRow would never be seen.
// The stub therefore stays put and a flag changes what it does.
let writes = [];
let upsertFails = false;
store.select = async (table, query) => {
  if (table === "connect_site_settings") {
    const m = /site_slug=eq\.([a-z0-9-]+)/.exec(String(query));
    const row = m ? SETTINGS_ROWS[m[1]] : null;
    return { ok: true, data: row ? [row] : [] };
  }
  if (table === "connect_threads" || table === "connect_messages") return { ok: true, data: [] };
  return { ok: true, data: [] };
};
store.upsertRow = async (table, row) => {
  if (upsertFails) return { ok: false, mode: "dry_run", table };
  writes.push({ table, row });
  return { ok: true, mode: "live_upsert", table };
};
store.recordEvent = async () => {};

const assistantHandler = require("../api/connect/assistant");

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: "", ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s === undefined ? "" : String(s); this.ended = true; },
  };
}

async function call(method, tok, { slug = "", body = null } = {}) {
  const url = `/api/connect/assistant${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`;
  const req = {
    method,
    url,
    headers: tok ? { "x-connect-token": tok, origin: "https://wss-ai.com" } : {},
    ...(body ? { body } : {}),
  };
  const res = makeRes();
  await assistantHandler(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body || "{}"), raw: res.body };
}

const alphaToken = signScopeToken("alpha");
const fullToken = "test-assistant-secret-abc";

test("no token reaches nothing", async () => {
  const r = await call("GET", "");
  assert.equal(r.status, 401);
});

test("a tenant reads its OWN settings without naming a slug", async () => {
  const r = await call("GET", alphaToken);
  assert.equal(r.status, 200);
  assert.equal(r.json.slug, "alpha");
  assert.equal(r.json.settings.aiChatEnabled, true);
  assert.equal(r.json.settings.customQa[0].question, "Free quotes?");
});

test("a tenant naming ANOTHER business's slug gets 404, and nothing of theirs leaks", async () => {
  const r = await call("GET", alphaToken, { slug: "beta" });
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.raw, /BETA-ONLY-SECRET/, "the other tenant's answers must never appear");
});

test("a tenant naming a slug that does not exist gets the SAME 404 — no directory", async () => {
  const foreign = await call("GET", alphaToken, { slug: "beta" });
  const fictional = await call("GET", alphaToken, { slug: "does-not-exist-at-all" });
  assert.equal(fictional.status, foreign.status);
  assert.equal(fictional.raw, foreign.raw, "a real slug and a fictional one must be indistinguishable");
});

test("a tenant may name its own slug", async () => {
  const r = await call("GET", alphaToken, { slug: "alpha" });
  assert.equal(r.status, 200);
  assert.equal(r.json.slug, "alpha");
});

test("a tenant cannot WRITE into another business's settings", async () => {
  writes = [];
  const r = await call("POST", alphaToken, { slug: "beta", body: { slug: "beta", aiChatEnabled: false } });
  assert.equal(r.status, 404);
  assert.equal(writes.length, 0, "nothing may be written for a slug the caller does not own");
});

test("a tenant's write always lands on its OWN slug, whatever the body says", async () => {
  writes = [];
  const r = await call("POST", alphaToken, { body: { takeoverSeconds: 60 } });
  assert.equal(r.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row.site_slug, "alpha");
  assert.equal(writes[0].row.takeover_seconds, 60);
});

test("an admin token must SAY which site — there is no implicit current site", async () => {
  const r = await call("GET", fullToken);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "slug_required_for_admin_scope");
});

test("an admin token may act on a named site", async () => {
  const r = await call("GET", fullToken, { slug: "beta" });
  assert.equal(r.status, 200);
  assert.equal(r.json.slug, "beta");
  assert.equal(r.json.settings.aiChatEnabled, false);
});

// ---------------------------------------------------------------------------
// api/connect/assistant.js — writes
// ---------------------------------------------------------------------------

test("only the five known keys are writable", async () => {
  writes = [];
  const r = await call("POST", alphaToken, { body: { greeting: "Hi there!", site_slug: "beta", ai_chat_enabled: false, id: 9 } });
  assert.equal(r.status, 200);
  const row = writes[0].row;
  assert.equal(row.site_slug, "alpha");
  assert.equal(row.greeting, "Hi there!");
  assert.equal(row.ai_chat_enabled, undefined, "a key the caller did not send through the public name is not written");
  assert.equal(row.id, undefined);
});

test("a body with nothing changeable in it is refused rather than written", async () => {
  writes = [];
  const r = await call("POST", alphaToken, { body: { nonsense: true } });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, "nothing_to_change");
  assert.equal(writes.length, 0);
});

test("a refused value is REPORTED, not silently dropped", async () => {
  writes = [];
  const r = await call("POST", alphaToken, { body: { bookingUrl: "http://not-secure.example.com/book" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  const reasons = (r.json.refusals || []).map((x) => x.reason);
  assert.ok(reasons.some((x) => String(x).startsWith("booking_url_not_https")), `expected an https refusal, got ${JSON.stringify(reasons)}`);
});

test("an owner answer carrying an unresolved template token is refused BY NAME", async () => {
  const r = await call("POST", alphaToken, {
    body: { customQa: [{ question: "Hours?", answer: "{{business_name}} is open late" }] },
  });
  assert.equal(r.status, 200);
  const reasons = (r.json.refusals || []).map((x) => x.reason);
  assert.ok(reasons.includes("custom_qa_unresolved_template_token"));
});

test("a store that cannot write says so instead of reporting a save", async () => {
  upsertFails = true;
  const r = await call("POST", alphaToken, { body: { greeting: "Hello" } });
  upsertFails = false;
  assert.equal(r.status, 502);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error, "settings_not_saved");
});

test("an oversized body is refused before anything is written", async () => {
  writes = [];
  const req = {
    method: "POST",
    url: "/api/connect/assistant",
    headers: { "x-connect-token": alphaToken, origin: "https://wss-ai.com" },
    body: { greeting: "x".repeat(300 * 1024) },
  };
  const res = makeRes();
  await assistantHandler(req, res);
  assert.equal(res.statusCode, 413);
  assert.equal(writes.length, 0);
});

test("an unsupported method is refused", async () => {
  const r = await call("DELETE", alphaToken);
  assert.equal(r.status, 405);
});

// ---------------------------------------------------------------------------
// The panel itself. The owner of this product asked for plain language in the
// plainest possible terms — "way too much of a computer coder, developer,
// computer language, not human like me" — so the storage vocabulary reaching
// his screen is a defect, not a cosmetic preference.
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const DASHBOARD = path.resolve(__dirname, "../../labs-site/dashboard/index.html");
const dashboardHtml = fs.readFileSync(DASHBOARD, "utf8");
const customerCopy = dashboardHtml
  .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
  .replace(/<script\b[\s\S]*?<\/script>/gi, " ");

test("no storage vocabulary reaches the customer's screen", () => {
  for (const jargon of ["ai_chat_enabled", "takeover_seconds", "custom_qa", "booking_url", "site_slug"]) {
    assert.doesNotMatch(customerCopy, new RegExp(jargon, "i"), `"${jargon}" is a column name, not something a person says`);
  }
});

test("each setting is named the way its owner would name it", () => {
  // The booking link was promoted from the settings list to its own
  // Appointments panel (major-league pass, 2026-08-17), so its owner-named
  // label lives in renderAppointments now; the assistant-tuning labels stay
  // in the assistant shell block.
  const settingsBlock = dashboardHtml.slice(dashboardHtml.indexOf("function renderAssistantShell"));
  for (const phrase of [
    "Let my assistant answer when",
    "Give me a head start to reply first",
    "Answers I want it to give",
  ]) {
    assert.ok(settingsBlock.includes(phrase), `the panel must say "${phrase}"`);
  }
  const apptBlock = dashboardHtml.slice(dashboardHtml.indexOf("function renderAppointments"));
  assert.ok(apptBlock.includes("My booking link"), "the Appointments panel must say \"My booking link\"");
});

test("removing a saved answer is bound to the pair, never to a stale row index", () => {
  const remove = dashboardHtml.slice(dashboardHtml.indexOf("function renderQaList"), dashboardHtml.indexOf("function addQaPair"));
  assert.match(remove, /indexOf\(pair\)/, "the handler must look the pair up by identity");
  assert.match(remove, /if\(at<0\)return/, "a click on an already-removed pair must do nothing");
  assert.doesNotMatch(remove, /splice\(Number\(/,
    "splicing by a rendered row index deletes a DIFFERENT answer once the list has redrawn");
});

test("the panel never draws settings it could not read", () => {
  const loader = dashboardHtml.slice(dashboardHtml.indexOf("function loadAssistant"));
  assert.match(loader, /available===false/, "an unreadable settings row must not fall through to defaults");
});
