"use strict";

// api/quote-request.js end to end, with the store, the mailer and Connect
// stubbed — the three things this endpoint is judged on:
//
//   1. the lead is WRITTEN TO connect_threads (the proof email sells "one inbox
//      for your messages"; before this change that table held three rows from a
//      July smoke test and not one real lead),
//   2. a PROSPECT's lead is never emailed to the prospect,
//   3. nothing — a dead mailer, a dead Connect, an unknown slug — makes the
//      endpoint claim success it did not have, because the form falls back to
//      mailto: on any non-2xx and a false 200 is a silently lost lead.

const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const handlerPath = require.resolve("../api/quote-request.js");
const storePath = require.resolve("../lib/store");
const emailPath = require.resolve("../lib/email");
const connectPath = require.resolve("../lib/connect");

const SLUG = "wss-test-rimrock-plumbing-billings";

function stubModule(path, exports) {
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
}

function fakeReq(body, headers = {}) {
  const req = new EventEmitter();
  req.method = "POST";
  req.headers = { origin: `https://${SLUG}.wss-ai.com`, "x-forwarded-for": "203.0.113.7", ...headers };
  req.body = body;
  req.socket = { remoteAddress: "203.0.113.7" };
  return req;
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    payload: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(text) { this.body = text; try { this.payload = JSON.parse(text); } catch { this.payload = text; } return this; },
  };
}

async function withHarness({ rows = {}, mailFails = false, connectFails = false, env = {} }, run) {
  const originals = [handlerPath, storePath, emailPath, connectPath].map((p) => [p, require.cache[p]]);
  const prevEnv = { RESEND_API_KEY: process.env.RESEND_API_KEY, GHOST_AGENCY_OWNER_EMAIL: process.env.GHOST_AGENCY_OWNER_EMAIL, GHOST_AGENCY_PROSPECT_SEND_ENABLED: process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED };
  const sent = [];
  const connectWrites = [];
  try {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.GHOST_AGENCY_OWNER_EMAIL = "woodwardsoftware@gmail.com";
    delete process.env.GHOST_AGENCY_PROSPECT_SEND_ENABLED;
    Object.assign(process.env, env);

    stubModule(storePath, {
      recordEvent: async () => ({ mode: "live_write" }),
      select: async (table) => ({ ok: true, data: rows[table] || [] }),
    });
    stubModule(emailPath, {
      sendResendEmail: async (input) => {
        sent.push(input);
        return mailFails ? { mode: "send_failed", error: "provider down" } : { mode: "sent", id: `re_${sent.length}` };
      },
    });
    stubModule(connectPath, {
      ensureThread: async (args) => {
        if (connectFails) throw new Error("connect_threads unreachable");
        connectWrites.push({ kind: "thread", ...args });
        return { id: 4242, ...args };
      },
      addMessage: async (threadId, direction, body, meta) => {
        connectWrites.push({ kind: "message", threadId, direction, body, meta });
        return { id: 9001 };
      },
      touchThread: async () => {},
    });

    delete require.cache[handlerPath];
    const handler = require(handlerPath);
    await run({ handler, sent, connectWrites });
  } finally {
    delete require.cache[handlerPath];
    for (const [p, mod] of originals) {
      if (mod) require.cache[p] = mod;
      else delete require.cache[p];
    }
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const LEAD = { slug: SLUG, name: "Dana Kerr", phone: "(406) 555-0134", email: "dana@example.com", service: "Water heater", message: "No hot water since Sunday." };

const PAID_ROWS = {
  ghost_agency_dashboard_access: [
    { job_id: "job_ck_9912", owner_email: "owner@rimrockplumbing.com", business_name: "Rimrock Plumbing", site_slug: SLUG },
  ],
};
const PROSPECT_ROWS = {
  ghost_agency_dashboard_access: [
    { job_id: `prospect-${SLUG}`, owner_email: "office@rimrockplumbing.com", business_name: "Rimrock Plumbing", site_slug: SLUG },
  ],
  ghost_agency_prospects: [
    { prospect_id: SLUG, business_name: "Rimrock Plumbing", email: "office@rimrockplumbing.com", preview_url: `https://${SLUG}.wss-ai.com/` },
  ],
};

test("a lead lands in connect_threads — the inbox the proof email promises", async () => {
  await withHarness({ rows: PROSPECT_ROWS }, async ({ handler, connectWrites }) => {
    const res = fakeRes();
    await handler(fakeReq(LEAD), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.thread_id, 4242);
    assert.equal(res.payload.message_id, 9001);

    const thread = connectWrites.find((w) => w.kind === "thread");
    assert.equal(thread.siteSlug, SLUG, "the thread is keyed on the slug a Connect token is scoped to");
    assert.equal(thread.threadKey, `${SLUG}:form:dana@example.com`);
    assert.equal(thread.contactName, "Dana Kerr");
    const message = connectWrites.find((w) => w.kind === "message");
    assert.equal(message.direction, "inbound");
    assert.match(message.body, /No hot water since Sunday/);
    assert.equal(message.meta.source, "site_form");
  });
});

test("a PROSPECT's lead is never emailed to the prospect", async () => {
  await withHarness({ rows: PROSPECT_ROWS }, async ({ handler, sent }) => {
    const res = fakeRes();
    await handler(fakeReq(LEAD), res);
    assert.equal(res.payload.route, "prospect_held");
    assert.match(res.payload.route_reason, /GHOST_AGENCY_PROSPECT_SEND_ENABLED/);
    assert.equal(sent.length, 1, "exactly one email: the owner's");
    assert.equal(sent[0].to, "woodwardsoftware@gmail.com");
    assert.equal(
      sent.some((m) => String(m.to).includes("rimrockplumbing.com")),
      false,
      "a business that never opted in must not be emailed",
    );
    // Held, but not lost: the owner's copy carries the whole lead.
    assert.match(sent[0].text, /No hot water since Sunday/);
    assert.match(sent[0].text, /NOT forwarded/);
  });
});

test("a PAID customer's lead reaches the paid customer, and the owner is copied separately", async () => {
  await withHarness({ rows: PAID_ROWS }, async ({ handler, sent }) => {
    const res = fakeRes();
    await handler(fakeReq(LEAD), res);
    assert.equal(res.payload.route, "customer");
    assert.equal(res.payload.delivery.client, "sent");
    assert.equal(res.payload.delivery.client_to, "owner@rimrockplumbing.com");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].to, "owner@rimrockplumbing.com");
    assert.equal(sent[0].replyTo, "dana@example.com", "the client replies straight to their customer");
    assert.equal(sent[1].to, "woodwardsoftware@gmail.com");
    // Two separate emails, never one with the owner CC'd onto the client's.
    assert.equal(sent[0].cc, undefined);
  });
});

test("a lead posted from somebody else's page is kept but never routed", async () => {
  await withHarness({ rows: PAID_ROWS }, async ({ handler, sent, connectWrites }) => {
    const res = fakeRes();
    await handler(fakeReq(LEAD, { origin: "https://wss-test-someone-else.wss-ai.com" }), res);
    assert.equal(res.payload.ok, true, "the lead is never thrown away over a header");
    assert.ok(connectWrites.some((w) => w.kind === "thread"), "it is still threaded");
    assert.match(res.payload.route_reason, /untrusted_origin/);
    assert.equal(res.payload.delivery.client_to, "");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "woodwardsoftware@gmail.com");
  });
});

test("Connect being down never costs the visitor their submission", async () => {
  await withHarness({ rows: PAID_ROWS, connectFails: true }, async ({ handler, sent }) => {
    const res = fakeRes();
    await handler(fakeReq(LEAD), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(res.payload.thread_id, null);
    assert.match(res.payload.connect_error, /unreachable/);
    assert.equal(sent.length, 2, "the lead still reaches both inboxes");
  });
});

test("a dropped write answers non-2xx so the form falls back to mailto:", async () => {
  const originals = [handlerPath, storePath, emailPath, connectPath].map((p) => [p, require.cache[p]]);
  try {
    stubModule(storePath, { recordEvent: async () => ({ mode: "live_write_failed", status: 500 }), select: async () => ({ ok: true, data: [] }) });
    stubModule(emailPath, { sendResendEmail: async () => ({ mode: "sent", id: "x" }) });
    stubModule(connectPath, { ensureThread: async () => ({ id: 1 }), addMessage: async () => ({ id: 1 }), touchThread: async () => {} });
    delete require.cache[handlerPath];
    const handler = require(handlerPath);
    const res = fakeRes();
    await handler(fakeReq(LEAD), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.payload.ok, false);
    assert.match(res.payload.error, /please call instead/);
  } finally {
    delete require.cache[handlerPath];
    for (const [p, mod] of originals) { if (mod) require.cache[p] = mod; else delete require.cache[p]; }
  }
});

test("a filled honeypot answers 200 and sends nothing at all", async () => {
  await withHarness({ rows: PAID_ROWS }, async ({ handler, sent, connectWrites }) => {
    const res = fakeRes();
    await handler(fakeReq({ ...LEAD, website: "http://spam.example" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.ok, true);
    assert.equal(sent.length, 0);
    assert.equal(connectWrites.length, 0);
  });
});

test("the ninth post in a minute from one address is refused", async () => {
  await withHarness({ rows: PAID_ROWS }, async ({ handler }) => {
    let last = null;
    for (let i = 0; i < 9; i += 1) {
      last = fakeRes();
      await handler(fakeReq({ ...LEAD, email: `dana${i}@example.com` }), last);
    }
    assert.equal(last.statusCode, 429);
    assert.equal(last.payload.error, "rate_limited");
  });
});
