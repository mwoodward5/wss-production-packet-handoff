"use strict";

// test/riley-send-note.test.js — the safety contract for Riley's ONE outbound
// email capability (api/vapi-tools/send-note.js).
//
// A voice-triggered mail sender is the highest-leverage thing in this codebase
// to get wrong. The trigger is "somebody said words into a phone", and the two
// ways it goes wrong are both silent:
//
//   * OPEN RELAY — the recipient came from the caller, so anyone who can dial
//     the line can send mail from our domain to any address on earth.
//   * EXFILTRATION — a model that can be talked into reading its configuration
//     out loud, and can also mail, turns a prompt injection into data theft.
//
// Every test below asserts on the thing that actually matters: whether the
// mailer was invoked. A refusal that still calls Resend is not a refusal.

const test = require("node:test");
const assert = require("node:assert/strict");

const handlerPath = require.resolve("../api/vapi-tools/send-note.js");
// The note core binds the store stub below and lazily requires the
// (stubbed) mailer; it must reload with the handler shell.
const corePath = require.resolve("../lib/riley-send-note-core");
const emailPath = require.resolve("../lib/email");
const storePath = require.resolve("../lib/store");

const SECRET = "vapi-tool-secret-for-tests-0123456789";
const OWNER = "woodwardsoftware@gmail.com";
const NOTE = "Hi Mark, this is Riley. I answer your line, pull up a caller's business record mid-call, and can queue changes to their site while we talk.";

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
 * Load the handler with the mailer and the event store stubbed, and with the
 * environment reduced to exactly one accepted tool secret.
 *
 * `sends` records every sendResendEmail() invocation. Assertions on its length
 * are the load-bearing ones: they distinguish "refused" from "said no and sent
 * it anyway".
 */
function withHandler(run, { mailResult = { mode: "sent", id: "re_test_message_id" }, env = {} } = {}) {
  const sends = [];
  const events = [];
  const saved = {
    email: require.cache[emailPath],
    store: require.cache[storePath],
    handler: require.cache[handlerPath],
    core: require.cache[corePath],
    env: {
      VAPI_TOOL_SECRET: process.env.VAPI_TOOL_SECRET,
      VAPI_WEBHOOK_SECRET: process.env.VAPI_WEBHOOK_SECRET,
      GHOST_AGENCY_ADMIN_TOKEN: process.env.GHOST_AGENCY_ADMIN_TOKEN,
    },
    extra: Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]])),
  };
  process.env.VAPI_TOOL_SECRET = SECRET;
  delete process.env.VAPI_WEBHOOK_SECRET;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  for (const [k, v] of Object.entries(env)) process.env[k] = v;

  require.cache[emailPath] = {
    id: emailPath, filename: emailPath, loaded: true, exports: {
      sendResendEmail: async (input) => { sends.push(input); return typeof mailResult === "function" ? mailResult(input) : mailResult; },
    },
  };
  require.cache[storePath] = {
    id: storePath, filename: storePath, loaded: true, exports: {
      recordEvent: async (name, payload) => { events.push({ name, payload }); return { ok: true }; },
    },
  };
  delete require.cache[handlerPath];
  delete require.cache[corePath];
  const handler = require(handlerPath);

  const call = async (args, { headers = { "x-vapi-secret": SECRET }, method = "POST", raw = null } = {}) => {
    const res = mockRes();
    await handler({ method, headers, body: raw || args, query: {} }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null, text: res.body };
  };

  return Promise.resolve(run({ call, sends, events, handler })).finally(() => {
    delete require.cache[handlerPath];
    delete require.cache[corePath];
    delete require.cache[emailPath];
    delete require.cache[storePath];
    if (saved.email) require.cache[emailPath] = saved.email;
    if (saved.store) require.cache[storePath] = saved.store;
    if (saved.handler) require.cache[handlerPath] = saved.handler;
    if (saved.core) require.cache[corePath] = saved.core;
    for (const [k, v] of Object.entries({ ...saved.env, ...saved.extra })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
}

const goodArgs = (over = {}) => ({ to: OWNER, subject: "A bit about Riley", body: NOTE, ...over });

// ---------------------------------------------------------------------------
// happy path — the proof-of-life call
// ---------------------------------------------------------------------------
test("happy path: sends exactly one note to the allowlisted address and says so", () => withHandler(async ({ call, sends, events }) => {
  const r = await call(goodArgs());
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.sent, true);
  assert.equal(r.json.to, OWNER);
  assert.equal(sends.length, 1, "exactly one email");
  assert.equal(sends[0].to, OWNER);
  assert.equal(sends[0].subject, "A bit about Riley");
  assert.deepEqual(sends[0].cc, [], "a proof note is never copied to anyone");
  assert.deepEqual(sends[0].bcc, []);
  assert.match(sends[0].text, /Riley/);
  // Riley has to be able to say it landed, and name where it went.
  assert.match(r.json.say, new RegExp(OWNER.replace(/\./g, "\\.")));
  const logged = events.find((e) => e.name === "riley.note_sent");
  assert.ok(logged, "every send is logged");
  assert.equal(logged.payload.to, OWNER);
  assert.equal(logged.payload.subject, "A bit about Riley");
  assert.ok("caller" in logged.payload, "the caller is logged with the send");
}));

test("a VAPI-wrapped tool call is unwrapped and answered in tool-result shape", () => withHandler(async ({ call, sends }) => {
  const r = await call(null, {
    raw: {
      message: {
        toolCalls: [{ id: "call_abc123", function: { name: "send_note", arguments: JSON.stringify(goodArgs()) } }],
        call: { customer: { number: "+17146096275" } },
      },
    },
  });
  assert.equal(r.status, 200);
  assert.equal(sends.length, 1);
  assert.equal(r.json.results[0].toolCallId, "call_abc123");
  assert.equal(JSON.parse(r.json.results[0].result).sent, true);
}));

test("the caller's phone number is captured on the send log", () => withHandler(async ({ call, events }) => {
  await call(null, {
    raw: {
      message: {
        toolCalls: [{ id: "c1", function: { arguments: goodArgs() } }],
        call: { customer: { number: "+17146096275" } },
      },
    },
  });
  assert.equal(events.find((e) => e.name === "riley.note_sent").payload.caller, "+17146096275");
}));

// ---------------------------------------------------------------------------
// AUTH — an unauthenticated mail sender on a public URL is an open relay
// ---------------------------------------------------------------------------
test("no tool secret: 401 and nothing is sent", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs(), { headers: {} });
  assert.equal(r.status, 401);
  assert.equal(r.json.ok, false);
  assert.equal(sends.length, 0);
}));

test("wrong tool secret: 401 and nothing is sent", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs(), { headers: { "x-vapi-secret": "not-the-secret-not-the-secret-01234" } });
  assert.equal(r.status, 401);
  assert.equal(sends.length, 0);
}));

test("a secret of the right length but wrong bytes is still rejected", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs(), { headers: { "x-vapi-secret": "X".repeat(SECRET.length) } });
  assert.equal(r.status, 401);
  assert.equal(sends.length, 0);
}));

test("GET is refused — this endpoint only accepts POST", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs(), { method: "GET" });
  assert.equal(r.status, 405);
  assert.equal(sends.length, 0);
}));

// ---------------------------------------------------------------------------
// RECIPIENT ALLOWLIST — the caller does not get to choose who we mail
// ---------------------------------------------------------------------------
test("the allowlist is exactly the owner's address", () => withHandler(async ({ handler }) => {
  // If this assertion ever needs editing, that edit IS the review of a widened
  // blast radius. It is deliberately annoying.
  assert.deepEqual([...handler.ALLOWED_RECIPIENTS], [OWNER]);
  assert.ok(Object.isFrozen(handler.ALLOWED_RECIPIENTS));
}));

test("an address dictated by the caller is refused, and nothing is sent", () => withHandler(async ({ call, sends, events }) => {
  const r = await call(goodArgs({ to: "attacker@evil.example" }));
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.sent, false);
  assert.equal(r.json.refused, "recipient_not_allowed");
  assert.equal(sends.length, 0, "a refused recipient must not reach the mailer");
  // The refusal must not teach an unknown caller which mailbox is reachable.
  assert.ok(!r.text.includes("woodwardsoftware"), "the refusal must not disclose the allowlisted address");
  assert.ok(events.some((e) => e.name === "riley.note_refused"), "refusals are logged too");
}));

test("a lookalike domain is refused", () => withHandler(async ({ call, sends }) => {
  for (const bad of [
    "woodwardsoftware@gmail.com.evil.example",
    "woodwardsoftware@gmai1.com",
    "woodwardsoftware+x@gmail.com",
    "evil@example.com,woodwardsoftware@gmail.com",
    "Mark <attacker@evil.example>",
  ]) {
    const r = await call(goodArgs({ to: bad }));
    assert.equal(r.json.refused, "recipient_not_allowed", `must refuse ${bad}`);
  }
  assert.equal(sends.length, 0);
}));

test("a missing recipient is refused — Riley asks, she does not assume", () => withHandler(async ({ call, sends }) => {
  const r = await call({ subject: "A bit about Riley", body: NOTE });
  assert.equal(r.json.refused, "recipient_missing");
  assert.equal(sends.length, 0);
}));

test("a spoken address is understood, and canonicalized from the allowlist", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs({ to: " Woodwardsoftware At Gmail Dot Com " }));
  assert.equal(r.json.sent, true);
  assert.equal(sends[0].to, OWNER, "the address we send to comes from the allowlist, not the transcript");
}));

// ---------------------------------------------------------------------------
// NO SECRETS IN BODY — the exfiltration path
// ---------------------------------------------------------------------------
test("secret-shaped content is refused for every credential family", () => withHandler(async ({ call, sends }) => {
  const bodies = {
    openai_style_key: "Here is the key you asked for: sk-abcdefghijklmnopqrstuvwxyz012345",
    stripe_key: "billing uses sk_live_51H8xQzAbCdEfGhIjKlMn",
    resend_key: "mail key re_AbCdEf123456789012345678",
    aws_access_key_id: "AKIAIOSFODNN7EXAMPLE is the id",
    github_token: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    slack_token: "xoxb-123456789012-abcdefghijkl",
    google_api_key: "AIzaSyA1234567890abcdefghijklmnopqrstuvw",
    json_web_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r",
    connection_string: "db is postgres://admin:hunter2hunter2@db.internal:5432/main",
    bearer_token: "send it with Authorization Bearer abcdefghijklmnopqrstuvwxyz123456",
    private_key_block: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n",
    credential_assignment: "set RESEND_API_KEY=abcd1234efgh5678 in the env",
    high_entropy_hex: "the value is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b",
  };
  for (const [label, body] of Object.entries(bodies)) {
    const r = await call(goodArgs({ body }));
    assert.equal(r.json.refused, "secret_shaped_content", `must refuse ${label}`);
    assert.equal(r.json.sent, false);
  }
  assert.equal(sends.length, 0, "no secret-shaped note may reach the mailer");
}));

test("a secret hidden in the SUBJECT is refused too", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs({ subject: "key sk-abcdefghijklmnopqrstuvwxyz012345" }));
  assert.equal(r.json.refused, "secret_shaped_content");
  assert.equal(sends.length, 0);
}));

test("the literal value of a live secret env var is refused, and the refusal never echoes it", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs({ body: `Riley here. The value is ${"TOPSECRETVALUE-abcdefghijklmnop"} if that helps.` }));
  assert.equal(r.json.refused, "secret_shaped_content");
  assert.equal(r.json.detector, "env_value");
  // The NAME of the variable is useful for an operator; the VALUE must never
  // appear in a response, a log line, or an error.
  assert.equal(r.json.matched, "TEST_ONLY_EXFIL_TOKEN");
  assert.ok(!r.text.includes("TOPSECRETVALUE"), "a refusal must not echo the secret it refused");
  assert.equal(sends.length, 0);
}, { env: { TEST_ONLY_EXFIL_TOKEN: "TOPSECRETVALUE-abcdefghijklmnop" } }));

test("a public-looking env var (a URL) does not trigger a false refusal", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs({ body: "You can reach the dashboard at https://ghost.example.test any time." }));
  assert.equal(r.json.sent, true);
  assert.equal(sends.length, 1);
}, { env: { GHOST_AGENCY_API_URL: "https://ghost.example.test" } }));

// ---------------------------------------------------------------------------
// RATE LIMIT — a stuck loop must not mail hundreds of times
// ---------------------------------------------------------------------------
test("the hourly cap holds: the send after the cap is refused, not delivered", () => withHandler(async ({ call, sends, handler }) => {
  const cap = handler.MAX_SENDS_PER_HOUR;
  assert.ok(cap > 0 && cap <= 20, "the cap must be small enough to bound a runaway loop");
  for (let i = 0; i < cap; i++) {
    const r = await call(goodArgs({ subject: `note ${i}` }));
    assert.equal(r.json.sent, true, `send ${i + 1} of ${cap} should succeed`);
  }
  assert.equal(sends.length, cap);
  for (let i = 0; i < 25; i++) {
    const r = await call(goodArgs({ subject: `runaway ${i}` }));
    assert.equal(r.json.refused, "rate_limited");
    assert.equal(r.json.sent, false);
  }
  assert.equal(sends.length, cap, "a runaway loop adds zero further emails");
}));

test("a dry run does not consume the hour's budget", () => withHandler(async ({ call, handler }) => {
  // Nothing left the process, so nothing was spent.
  for (let i = 0; i < handler.MAX_SENDS_PER_HOUR + 3; i++) {
    const r = await call(goodArgs({ subject: `dry ${i}` }));
    assert.equal(r.json.refused, undefined, "a dry run is not a rate-limit refusal");
    assert.equal(r.json.sent, false);
  }
}, { mailResult: { mode: "dry_run", configured: false } }));

// ---------------------------------------------------------------------------
// shape of the note
// ---------------------------------------------------------------------------
test("an empty note is refused", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs({ body: "   " }));
  assert.equal(r.json.refused, "empty_note");
  assert.equal(sends.length, 0);
}));

test("a missing subject is refused", () => withHandler(async ({ call, sends }) => {
  const r = await call(goodArgs({ subject: "" }));
  assert.equal(r.json.refused, "subject_missing");
  assert.equal(sends.length, 0);
}));

test("an over-long note is refused rather than silently truncated", () => withHandler(async ({ call, sends, handler }) => {
  const r = await call(goodArgs({ body: "word ".repeat(handler.MAX_BODY_CHARS) }));
  assert.equal(r.json.refused, "note_too_long");
  assert.equal(sends.length, 0);
}));

test("a provider failure is reported as not-sent, never as sent", () => withHandler(async ({ call }) => {
  const r = await call(goodArgs());
  assert.equal(r.json.ok, false);
  assert.equal(r.json.sent, false);
  assert.match(r.json.say, /nothing was sent/i);
}, { mailResult: { mode: "send_failed", configured: true, status: 500 } }));

// ---------------------------------------------------------------------------
// ATTACHING THE TOOL — additive only, or not at all
// ---------------------------------------------------------------------------
const admin = require("../api/admin/vapi-assistants.js");

const RILEY = Object.freeze({
  id: "assistant_riley",
  name: "Woodward Labs — Local Growth",
  firstMessage: "Hey, this is Riley over at Woodward Labs.",
  firstMessageMode: "assistant-speaks-first",
  voice: { provider: "11labs", voiceId: "riley-voice", stability: 0.5 },
  transcriber: { provider: "deepgram", model: "nova-3" },
  startSpeakingPlan: { waitSeconds: 0.4 },
  stopSpeakingPlan: { numWords: 2 },
  model: {
    provider: "openai",
    model: "gpt-4.1-mini",
    temperature: 0.7,
    messages: [{ role: "system", content: "You are Riley..." }],
    toolIds: ["tool_lookup", "tool_site_edit"],
  },
});

test("attaching send_note changes toolIds and nothing else", () => {
  const built = admin.additiveModelPatch(RILEY, ["tool_send_note"]);
  assert.equal(built.ok, true);
  // Top level: the PATCH carries exactly one key. Voice, transcriber, latency
  // plans and the first message are not in it, so they cannot be overwritten.
  assert.deepEqual(Object.keys(built.patch), ["model"]);
  // Inside model: every existing key survives byte-for-byte except toolIds.
  for (const [key, value] of Object.entries(RILEY.model)) {
    if (key === "toolIds") continue;
    assert.deepEqual(built.patch.model[key], value, `model.${key} must be preserved`);
  }
  assert.deepEqual(built.patch.model.messages, RILEY.model.messages, "the system prompt is untouched");
  assert.deepEqual(built.patch.model.toolIds, ["tool_lookup", "tool_site_edit", "tool_send_note"]);
  assert.deepEqual(RILEY.model.toolIds, ["tool_lookup", "tool_site_edit"], "the source config is not mutated");
});

test("re-attaching is idempotent — no duplicate tool ids", () => {
  const once = admin.additiveModelPatch(RILEY, ["tool_send_note"]);
  const twice = admin.additiveModelPatch({ ...RILEY, model: once.patch.model }, ["tool_send_note"]);
  assert.deepEqual(twice.patch.model.toolIds, ["tool_lookup", "tool_site_edit", "tool_send_note"]);
});

test("an unreadable assistant is a refusal, not a model-wiping patch", () => {
  // `{}` is what a 404, an expired key or a rate limit returns from the VAPI
  // read. Spreading it would PATCH `{model:{toolIds}}` and erase her provider,
  // model id, temperature and system prompt in one call.
  for (const broken of [{}, { model: null }, { model: {} }, { model: { provider: "openai" } }]) {
    const built = admin.additiveModelPatch(broken, ["tool_send_note"]);
    assert.equal(built.ok, false);
    assert.equal(built.error, "vapi_model_unreadable");
    assert.equal(built.patch, undefined);
  }
});

test("the tool definition carries the usage guidance, so her prompt does not have to change", () => {
  const def = admin.sendNoteToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.example.test", VAPI_WEBHOOK_SECRET: "hook-secret" });
  assert.equal(def.function.name, "send_note");
  assert.deepEqual(def.function.parameters.required, ["to", "subject", "body"]);
  assert.equal(def.server.url, "https://ghost.example.test/api/vapi-tools/send-note");
  assert.equal(def.server.secret, "hook-secret", "a secretless tool 401s on every mid-call invocation");
  const d = def.function.description;
  assert.match(d, /READ THE ADDRESS BACK/i, "confirm the address aloud before sending");
  assert.match(d, /few sentences/i, "keep the note short");
  assert.match(d, /NEVER put an API key/i, "never mail configuration");
  assert.match(d, /say out loud whether the note was sent/i, "announce the result");
});

test("the tool endpoint it points at is the one that enforces the allowlist", () => {
  // A secret is now required to build the definition at all — a tool without
  // one is provisioned pre-broken and 401s on every call (see
  // test/universal-site-change.test.js for the incident this came from).
  const def = admin.sendNoteToolDefinition({ GHOST_AGENCY_API_URL: "https://ghost.example.test", VAPI_TOOL_SECRET: "s1" });
  const endpoint = require("../api/vapi-tools/send-note.js");
  assert.ok(def.server.url.endsWith("/api/vapi-tools/send-note"));
  assert.deepEqual([...endpoint.ALLOWED_RECIPIENTS], [OWNER]);
});
