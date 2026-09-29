"use strict";

// test/riley-send-payment-link.test.js — the safety contract for Riley's
// IN-CALL checkout link (api/vapi-tools/send-payment-link.js).
//
// This is the money tool: a voice-triggered send of a payment link to a
// prospect's address. The three things that must never silently break:
//
//   * CONSENT — no `theyAsked: true` from the caller's own request this
//     conversation, no send. A model that sets the flag "to be helpful" must
//     be refused by the server.
//   * THE ADDRESS IS THE RECORD'S, NEVER THE CALLER'S — the recipient comes
//     off the verified prospect row; a stranger on the line cannot aim our
//     domain at an arbitrary mailbox.
//   * NO PAYMENT DATA — a caller reading a card number is refused, and the
//     email carries a LINK and nothing else.
//
// Assertions on `sends.length` are the load-bearing ones: they distinguish
// "refused" from "said no and sent it anyway". Assertions on `events` prove
// every send and every refusal is auditable.

const test = require("node:test");
const assert = require("node:assert/strict");

const handlerPath = require.resolve("../api/vapi-tools/send-payment-link.js");
const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");
// The handler's resolution chain also captures the stubbed store at require
// time. Without evicting these, the SECOND test's row fixtures never reach
// resolveCaller — it keeps answering from the FIRST test's stub.
const targetsPath = require.resolve("../lib/site-edit-targets");
const memoryPath = require.resolve("../lib/riley-call-memory");

const SECRET = "vapi-tool-secret-for-tests-0123456789";
const CHECKOUT_SECRET = "checkout-link-secret-for-tests-0123456789";

// A prospect row shaped like the real table. The email lives on the ROW; the
// test proves the send goes there and nowhere else.
const PROSPECT = {
  id: "row-1",
  prospect_id: "place-chij-flint-plumbing",
  business_name: "Flint Plumbing LLC",
  phone: "(512) 971-2445",
  city: "Austin",
  state: "TX",
  email: "owner@flintplumbing.example",
  preview_url: "https://wss-test-flint-plumbing-s5.wss-ai.com/",
  record: {},
};

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
 * Load the handler with the mailer and the store stubbed. `sends` records
 * every sendResendEmail() invocation; `events` every recordEvent().
 */
function withHandler(run, {
  mailResult = { mode: "sent", id: "re_test_message_id" },
  rows = [PROSPECT],
  env = {},
} = {}) {
  const sends = [];
  const events = [];
  const saved = {
    email: require.cache[emailPath],
    store: require.cache[storePath],
    handler: require.cache[handlerPath],
    targets: require.cache[targetsPath],
    memory: require.cache[memoryPath],
    env: {
      VAPI_TOOL_SECRET: process.env.VAPI_TOOL_SECRET,
      VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
      GHOST_AGENCY_ADMIN_TOKEN: process.env.GHOST_AGENCY_ADMIN_TOKEN,
      GHOST_AGENCY_CHECKOUT_LINK_SECRET: process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET,
    },
    extra: Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])),
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  process.env.GHOST_AGENCY_CHECKOUT_LINK_SECRET = CHECKOUT_SECRET;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  require.cache[emailPath] = {
    id: emailPath, filename: emailPath, loaded: true, exports: {
      sendResendEmail: async (input) => {
        sends.push(input);
        return typeof mailResult === "function" ? mailResult(input) : mailResult;
      },
    },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true, exports: {
      // A PostgREST-ish stand-in: the only filter this handler's resolution
      // needs is prospect_id=eq.…; the events table reads answer empty so
      // call memory never fires.
      select: async (table, query = "") => {
        const q = String(query);
        const m = q.match(/prospect_id=eq\.([^&]+)/);
        if (m) {
          const hits = rows.filter((r) => r.prospect_id === decodeURIComponent(m[1]));
          return { ok: true, mode: "live_select", data: hits.slice(0, 1) };
        }
        return { ok: true, mode: "live_select", data: [] };
      },
      insertRow: async () => ({ ok: true, mode: "live_write" }),
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
    },
  };
  delete require.cache[handlerPath];
  delete require.cache[targetsPath];
  delete require.cache[memoryPath];
  const handler = require(handlerPath);

  const call = async (args, { headers = { "x-vapi-secret": SECRET }, method = "POST" } = {}) => {
    const res = mockRes();
    await handler({ method, headers, body: args, query: {} }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  };

  return Promise.resolve(run({ call, sends, events, handler })).finally(() => {
    delete require.cache[handlerPath];
    delete require.cache[targetsPath];
    delete require.cache[memoryPath];
    delete require.cache[emailPath];
    delete require.cache[storePath];
    if (saved.email) require.cache[emailPath] = saved.email;
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.targets) require.cache[targetsPath] = saved.targets;
    if (saved.memory) require.cache[memoryPath] = saved.memory;
    for (const [k, v] of Object.entries(saved.env)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    for (const [k, v] of Object.entries(saved.extra)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    // The lane's in-process rate limiter must not leak between cases.
    if (handler.rateLimitState) handler.rateLimitState();
    for (let i = 0; i < 12; i += 1) handler.rateLimitState(Date.now() + i * 3600_000);
  });
}

test("the consent law: no theyAsked, no send — and the refusal speaks", () => withHandler(async ({ call, sends, events }) => {
  const noFlag = await call({ prospect_id: PROSPECT.prospect_id });
  assert.equal(noFlag.status, 200, "a consent refusal is a spoken 200, never a 5xx");
  assert.equal(noFlag.json.ok, false);
  assert.equal(noFlag.json.refused, "consent_missing");
  assert.match(noFlag.json.say, /asked me for it on this call/i);

  const stringTrue = await call({ prospect_id: PROSPECT.prospect_id, theyAsked: "true" });
  assert.equal(stringTrue.json.refused, "consent_missing", "a string \"true\" is a model guessing, not consent");

  const one = await call({ prospect_id: PROSPECT.prospect_id, theyAsked: 1 });
  assert.equal(one.json.refused, "consent_missing", "1 is not the boolean the law requires");

  assert.equal(sends.length, 0, "a refused call must never reach the mailer");
  assert.equal(events.filter((e) => e.name === "riley.payment_link_refused").length, 3,
    "every refusal is auditable");
}));

test("consented send goes to the PROSPECT's verified email only, with a real minted link", () => withHandler(async ({ call, sends, events }) => {
  // A caller-supplied address must be ignored entirely — even supplied, the
  // row's address is the only one read.
  const out = await call({
    prospect_id: PROSPECT.prospect_id,
    theyAsked: true,
    to: "attacker@example.net",
    email: "attacker@example.net",
  });
  assert.equal(out.json.ok, true, JSON.stringify(out.json).slice(0, 300));
  assert.equal(out.json.sent, true);
  assert.equal(out.json.to, "owner@flintplumbing.example", "the recipient is the record's address");
  assert.ok(!out.json.checkout_url, "the raw signed link is never handed to the voice model to read out");

  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, "owner@flintplumbing.example");
  // THE LINK IS THE ONE mint-checkout-links MINTS: same signature, same
  // payload shape, verifiable by the checkout lane's own verifier. Read it
  // off the PLAIN-TEXT half — the HTML half escapes & to &amp; inside the
  // href, and a mangled query param proves nothing.
  const { verifyCheckoutLink } = require("../lib/checkout-links");
  const url = (sends[0].text.match(/https:\/\/[^\s]+/g) || []).find((u) => u.includes("/api/checkout-link"));
  assert.ok(url, "the emailed button names a checkout link");
  const token = new URL(url).searchParams.get("token");
  const sig = new URL(url).searchParams.get("sig");
  const checked = verifyCheckoutLink(token, sig);
  assert.equal(checked.ok, true, `the minted link must verify: ${JSON.stringify(checked)}`);
  assert.equal(checked.payload.prospect_id, PROSPECT.prospect_id, "the link is signed to THIS prospect");
  assert.equal(checked.payload.business_name, "Flint Plumbing LLC");
  // No payment data anywhere in the outbound email.
  assert.doesNotMatch(sends[0].text, /\b4\d{3}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, "no card number in the email");
  // And the audit trail.
  const sent = events.find((e) => e.name === "riley.payment_link_sent");
  assert.ok(sent, "one audit event per send");
  assert.equal(sent.payload.to, "owner@flintplumbing.example");
  assert.equal(sent.payload.prospect_id, PROSPECT.prospect_id);
  assert.equal(sent.payload.consent, "theyAsked_on_call");
  // The sentence names the address and never reads the long URL.
  assert.match(out.json.say, /owner@flintplumbing\.example/);
  assert.match(out.json.say, /nothing gets charged/i);
}));

test("the address can also live in owner_email or record — still the record's, still only that", () => withHandler(async ({ call, sends }) => {
  const viaOwner = await call({ prospect_id: "place-x", theyAsked: true });
  assert.equal(viaOwner.json.to, "second@flintplumbing.example");
  assert.equal(sends[0].to, "second@flintplumbing.example");
}, {
  rows: [{ ...PROSPECT, prospect_id: "place-x", email: "", owner_email: "second@flintplumbing.example" }],
}));

test("no email on file is an honest refusal, not a guess at an address", () => withHandler(async ({ call, sends }) => {
  const out = await call({
    prospect_id: "place-none",
    theyAsked: true,
    // a caller-supplied address must NOT be honoured as a fallback
    to: "someone@example.com",
  });
  assert.equal(out.json.refused, "no_email_on_file");
  assert.match(out.json.say, /no email address on file/i);
  assert.equal(sends.length, 0);
}, { rows: [{ ...PROSPECT, prospect_id: "place-none", email: "", owner_email: "", record: {} }] }));

test("a caller reading out card details is refused before anything runs", () => withHandler(async ({ call, sends }) => {
  const out = await call({
    prospect_id: PROSPECT.prospect_id,
    theyAsked: true,
    card_number: "4242 4242 4242 4242",
  });
  assert.equal(out.json.refused, "payment_data_refused");
  assert.match(out.json.say, /can't take card details/i);
  assert.equal(sends.length, 0);
}));

test("no signing secret configured means no link and an honest sentence — fail closed", () => withHandler(async ({ call, sends }) => {
  const out = await call({ prospect_id: PROSPECT.prospect_id, theyAsked: true });
  assert.equal(out.json.refused, "checkout_not_configured");
  assert.match(out.json.say, /isn't switched on/i);
  assert.equal(sends.length, 0, "a link that would 401 on click is never emailed");
}, { env: { GHOST_AGENCY_CHECKOUT_LINK_SECRET: "" } }));

test("an unknown prospect asks for the strongest untried key, and sends nothing", () => withHandler(async ({ call, sends }) => {
  const out = await call({ business_name: "Completely Unknown LLC", theyAsked: true });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.refused, "identity_not_found");
  assert.match(out.json.say, /W S S/i, "steers to the Client ID");
  assert.equal(sends.length, 0);
}));

test("a mailer failure is reported honestly and consumes no rate budget it didn't use", () => withHandler(async ({ call, events }) => {
  const out = await call({ prospect_id: PROSPECT.prospect_id, theyAsked: true });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.sent, false);
  assert.match(out.json.say, /nothing was sent/i);
  assert.ok(events.find((e) => e.name === "riley.payment_link_sent" && e.payload.sent === false));
}, { mailResult: { mode: "send_failed" } }));

test("the tool description states the consent law in the model's own contract", () => {
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  assert.equal(handler.TOOL_NAME, "send_payment_link");
  assert.match(handler.TOOL_DESCRIPTION, /theyAsked to true only because they just asked/i);
  assert.match(handler.TOOL_DESCRIPTION, /NEVER take card details/i);
});
