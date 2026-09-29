"use strict";

// WSS Connect Web Push — owner proof.
//
// These tests lock the four safety properties that matter more than the
// browser plumbing itself:
//   1. a subscription is pinned to the tenant slug proven by the token,
//   2. a dead (410) endpoint is removed for that tenant,
//   3. notification payloads have one small, explicit data surface, and
//   4. the page never asks for notification permission until a person taps.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const subscribePath = path.resolve(__dirname, "../api/connect/push-subscribe.js");
const pushPath = path.resolve(__dirname, "../lib/connect-push.js");
const quoteRequestPath = path.resolve(__dirname, "../api/quote-request.js");
const storePath = require.resolve("../lib/store.js");
const pushSqlPath = path.resolve(__dirname, "../sql/connect_push.sql");

const TEST_SECRET = "connect-push-owner-proof-secret";
const ALPHA = "alpha-plumbing-tulsa";
const BETA = "beta-roofing-tulsa";

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function makeKeys() {
  const vapid = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const vapidJwk = vapid.privateKey.export({ format: "jwk" });
  const browser = crypto.createECDH("prime256v1");
  browser.generateKeys();
  return {
    publicKey: base64url(Buffer.concat([
      Buffer.from([0x04]),
      Buffer.from(vapidJwk.x, "base64url"),
      Buffer.from(vapidJwk.y, "base64url"),
    ])),
    privateKey: vapidJwk.d,
    p256dh: base64url(browser.getPublicKey()),
    auth: base64url(crypto.randomBytes(16)),
  };
}

const keys = makeKeys();
const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-alpha",
  expirationTime: null,
  keys: { p256dh: keys.p256dh, auth: keys.auth },
  toJSON() {
    return { endpoint: this.endpoint, expirationTime: this.expirationTime, keys: this.keys };
  },
};

function response(status, json = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get() { return null; } },
    json: async () => json,
    text: async () => (json && Object.keys(json).length ? JSON.stringify(json) : ""),
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = value === undefined ? "" : String(value); return this; },
  };
}

function parsed(res) {
  return res.body ? JSON.parse(res.body) : {};
}

async function withPushEnv(run) {
  const names = [
    "CONNECT_APP_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CONNECT_VAPID_PUBLIC_KEY",
    "CONNECT_VAPID_PRIVATE_KEY",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = global.fetch;
  process.env.CONNECT_APP_TOKEN = TEST_SECRET;
  process.env.SUPABASE_URL = "https://project.supabase.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  // Keep both conventional names during the implementation handoff. The
  // shipped module may use only CONNECT_VAPID_*; no key reaches a client test.
  process.env.CONNECT_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.CONNECT_VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:woodwardsoftware@gmail.com";
  try {
    return await run();
  } finally {
    global.fetch = originalFetch;
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    delete require.cache[subscribePath];
    delete require.cache[pushPath];
  }
}

async function callSubscribe(handler, { method = "POST", token = "", body = {} } = {}) {
  const req = {
    method,
    headers: {
      origin: "https://connect.wss-labs.com",
      ...(token ? { "x-connect-token": token } : {}),
    },
    body,
    query: {},
    socket: { remoteAddress: "203.0.113.8" },
  };
  const res = makeRes();
  await handler(req, res);
  return res;
}

test("push subscription storage is authenticated and pinned to the token's tenant", async () => {
  await withPushEnv(async () => {
    const writes = [];
    global.fetch = async (url, init = {}) => {
      writes.push({ url: String(url), init });
      return response(201, [{ id: "sub-alpha" }]);
    };

    // Load after CONNECT_APP_TOKEN is in place so the real auth path signs and
    // verifies the tenant token. Only the Supabase REST write is faked.
    delete require.cache[subscribePath];
    const handler = require(subscribePath);
    const { signScopeToken } = require("../lib/dashboard-link.js");
    const alphaToken = signScopeToken(ALPHA);

    const accepted = await callSubscribe(handler, {
      token: alphaToken,
      body: { subscription, siteSlug: BETA },
    });
    assert.ok([200, 201].includes(accepted.statusCode), accepted.body);
    assert.equal(parsed(accepted).ok, true);
    assert.equal(writes.length, 1, "one subscription creates one durable write");

    const write = writes[0];
    const url = new URL(write.url);
    assert.match(url.pathname, /\/rest\/v1\/connect_push_subscriptions$/);
    assert.equal(
      url.searchParams.get("on_conflict"),
      "site_slug,endpoint",
      "an endpoint cannot be reassigned across tenants by a global-endpoint upsert",
    );
    assert.equal(String(write.init.method).toUpperCase(), "POST");
    const row = JSON.parse(write.init.body);
    assert.equal(row.site_slug, ALPHA, "the signed token, never the body, chooses the tenant");
    assert.equal(row.endpoint, subscription.endpoint);
    assert.equal(row.p256dh, subscription.keys.p256dh);
    assert.equal(row.auth, subscription.keys.auth);
    assert.doesNotMatch(`${write.url}\n${write.init.body}`, new RegExp(BETA), "a caller cannot smuggle another tenant into storage");

    writes.length = 0;
    const missing = await callSubscribe(handler, { body: { subscription } });
    assert.equal(missing.statusCode, 401);
    assert.equal(writes.length, 0, "an unauthenticated request never reaches storage");
  });
});

test("a full token with no bound site cannot choose a tenant in request JSON", async () => {
  await withPushEnv(async () => {
    const writes = [];
    global.fetch = async (url, init) => { writes.push({ url: String(url), init }); return response(201, []); };
    delete require.cache[subscribePath];
    const handler = require(subscribePath);
    const res = await callSubscribe(handler, {
      token: TEST_SECRET,
      body: { subscription, siteSlug: BETA },
    });
    assert.ok([400, 403].includes(res.statusCode), `expected an unbound-token refusal, got ${res.statusCode}: ${res.body}`);
    assert.equal(writes.length, 0, "an unbound full token cannot create a tenant row from client input");
  });
});

test("a malformed 65-byte browser key is rejected before storage", async () => {
  await withPushEnv(async () => {
    const writes = [];
    global.fetch = async (url, init) => { writes.push({ url: String(url), init }); return response(201, []); };
    delete require.cache[subscribePath];
    const handler = require(subscribePath);
    const { signScopeToken } = require("../lib/dashboard-link.js");
    const malformed = Buffer.from(keys.p256dh, "base64url");
    assert.equal(malformed.length, 65);
    malformed[0] = 0x02; // compressed-point marker with an uncompressed length
    const res = await callSubscribe(handler, {
      token: signScopeToken(ALPHA),
      body: {
        subscription: {
          endpoint: subscription.endpoint,
          keys: { p256dh: malformed.toString("base64url"), auth: keys.auth },
        },
      },
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(parsed(res).error, "invalid_subscription");
    assert.equal(writes.length, 0, "an invalid EC point never reaches the durable table");
  });
});

test("authenticated GET returns the public VAPID key and never the private key", async () => {
  await withPushEnv(async () => {
    global.fetch = async () => { throw new Error("GET must not touch Supabase"); };
    delete require.cache[subscribePath];
    const handler = require(subscribePath);
    const { signScopeToken } = require("../lib/dashboard-link.js");
    const res = await callSubscribe(handler, { method: "GET", token: signScopeToken(ALPHA) });
    assert.equal(res.statusCode, 200, res.body);
    const body = parsed(res);
    assert.equal(body.ok, true);
    assert.equal(body.publicKey, keys.publicKey);
    assert.doesNotMatch(res.body, new RegExp(keys.privateKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("a 410 push response prunes only that dead subscription in that tenant", async () => {
  await withPushEnv(async () => {
    const originalStore = require.cache[storePath];
    const calls = [];
    const events = [];
    let selectedQuery = "";
    try {
      require.cache[storePath] = {
        id: storePath,
        filename: storePath,
        loaded: true,
        exports: {
          select: async (table, query) => {
            assert.equal(table, "connect_push_subscriptions");
            selectedQuery = String(query);
            return {
              ok: true,
              data: [{
                id: "dead-alpha-device",
                site_slug: ALPHA,
                endpoint: subscription.endpoint,
                p256dh: subscription.keys.p256dh,
                auth: subscription.keys.auth,
                subscription,
              }],
            };
          },
          recordEvent: async (type, payload) => { events.push({ type, payload }); return { mode: "live_write" }; },
          event: async (entry) => { events.push(entry); return { mode: "live_write" }; },
        },
      };
      global.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        if (String(url) === subscription.endpoint) return response(410);
        if (String(url).includes("/rest/v1/connect_push_subscriptions")) return response(204);
        throw new Error(`unexpected network call: ${url}`);
      };

      delete require.cache[pushPath];
      const { sendConnectPush } = require(pushPath);
      assert.equal(typeof sendConnectPush, "function");
      await sendConnectPush({
        siteSlug: ALPHA,
        sender: "Dana Kerr",
        snippet: "The water heater stopped Sunday.",
        threadId: "thread-alpha-7",
        kind: "chat",
      });

      assert.match(decodeURIComponent(selectedQuery), new RegExp(`site_slug=eq\\.${ALPHA}`));
      const sent = calls.filter((call) => call.url === subscription.endpoint);
      assert.equal(sent.length, 1, "the retained subscription is attempted once");
      assert.equal(sent[0].init.redirect, "manual", "a push endpoint cannot redirect the sender into an SSRF hop");

      const deletes = calls.filter((call) => String(call.init.method).toUpperCase() === "DELETE");
      assert.equal(deletes.length, 1, "HTTP 410 must remove the dead endpoint");
      const deleted = new URL(deletes[0].url);
      assert.match(deleted.pathname, /\/rest\/v1\/connect_push_subscriptions$/);
      assert.equal(deleted.searchParams.get("site_slug"), `eq.${ALPHA}`, "pruning stays inside the selected tenant");
      assert.ok(
        deleted.searchParams.get("id") === "eq.dead-alpha-device"
          || String(deleted.searchParams.get("endpoint") || "").includes(subscription.endpoint),
        "the DELETE must identify only the endpoint that returned 410",
      );
      assert.ok(events.length >= 1, "the prune is visible in the event log");
    } finally {
      delete require.cache[pushPath];
      if (originalStore) require.cache[storePath] = originalStore;
      else delete require.cache[storePath];
    }
  });
});

test("the push payload has an exact small allowlist and caps the snippet", async () => {
  await withPushEnv(async () => {
    delete require.cache[pushPath];
    const { buildConnectPushPayload } = require(pushPath);
    assert.equal(typeof buildConnectPushPayload, "function");
    const payload = buildConnectPushPayload({
      sender: "Dana Kerr",
      snippet: "A".repeat(120),
      threadId: "thread-alpha-7",
      kind: "chat",
      email: "private-lead@example.test",
      phone: "+1-949-555-0199",
      ownerEmail: "owner-private@example.test",
      siteSlug: ALPHA,
    });

    assert.deepEqual(Object.keys(payload).sort(), ["body", "threadId", "title"]);
    assert.match(payload.title, /Dana Kerr/);
    assert.equal(payload.body, "A".repeat(80));
    assert.equal(payload.threadId, "thread-alpha-7");
    const wire = JSON.stringify(payload);
    assert.doesNotMatch(wire, /private-lead|949-555|owner-private|alpha-plumbing/i);

    const unicode = buildConnectPushPayload({
      sender: "Website visitor",
      snippet: "🙂".repeat(81),
      threadId: "thread-unicode",
      kind: "chat",
    });
    assert.equal(Array.from(unicode.body).length, 80, "the cap counts visible code points, not UTF-16 halves");
    assert.equal(unicode.body, "🙂".repeat(80), "the cap must not cut an emoji in half");

    const whitespace = buildConnectPushPayload({
      sender: "  Dana\n\tKerr  ",
      snippet: "  Water heater\n\tstopped Sunday.  ",
      threadId: "thread-clean",
    });
    assert.equal(whitespace.title, "Dana Kerr");
    assert.equal(whitespace.body, "Water heater stopped Sunday.");

    const redacted = buildConnectPushPayload({
      sender: "dana.private@example.com",
      snippet: "Email dana.private@example.com or call +1 (949) 555-0199. " + "A".repeat(120),
      threadId: "thread-redacted",
    });
    assert.ok(redacted.title, "redaction must leave an honest, non-empty sender label");
    assert.doesNotMatch(redacted.title, /dana\.private|example\.com|@/i);
    assert.doesNotMatch(redacted.body, /dana\.private|example\.com|949|555|0199|\+1/i);
    assert.ok(Array.from(redacted.body).length <= 80);
    assert.match(redacted.body, /A+$/, "redaction runs before the cap, so safe text after the PII is retained");

    const phoneSender = buildConnectPushPayload({
      sender: "+1 (949) 555-0199",
      snippet: "Water heater stopped.",
      threadId: "thread-phone-sender",
    });
    assert.ok(phoneSender.title, "redaction must leave an honest, non-empty sender label");
    assert.doesNotMatch(phoneSender.title, /949|555|0199|\+1/);

    const uncommonPhoneForms = buildConnectPushPayload({
      sender: "Call 949/555/0199 or ９４９―５５５―０１９９",
      snippet: "Other formats 949–555–0199 and ９４９５５５０１９９",
      threadId: "thread-phone-unicode",
    });
    assert.doesNotMatch(uncommonPhoneForms.title, /949|0199|９４９|０１９９/);
    assert.doesNotMatch(uncommonPhoneForms.body, /949|0199|９４９|０１９９/);
  });
});

test("only known browser push services can become outbound endpoints", () => {
  delete require.cache[pushPath];
  const { normalizePushEndpoint } = require(pushPath);
  assert.match(normalizePushEndpoint("https://fcm.googleapis.com/fcm/send/device"), /^https:\/\/fcm\.googleapis\.com\//);
  assert.match(normalizePushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/device"), /^https:\/\/updates\.push\.services\.mozilla\.com\//);
  assert.match(normalizePushEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=device"), /^https:\/\/wns2-bl2p\.notify\.windows\.com\//);
  assert.equal(normalizePushEndpoint("https://localhost./push"), "");
  assert.equal(normalizePushEndpoint("https://127.0.0.1/push"), "");
  assert.equal(normalizePushEndpoint("https://push.attacker.example/push"), "");
});

test("the subscription table is indexed by tenant and closed to browser roles", () => {
  const sql = fs.readFileSync(pushSqlPath, "utf8");
  assert.match(sql, /create table if not exists public\.connect_push_subscriptions/i);
  assert.match(sql, /site_slug text not null/i);
  assert.match(sql, /unique\s*\(\s*site_slug\s*,\s*endpoint\s*\)/i, "device identity is composite with its tenant");
  assert.doesNotMatch(sql, /endpoint text not null unique/i, "a global endpoint constraint enables cross-tenant reassignment");
  assert.match(sql, /connect_push_subscriptions_site_slug_idx[\s\S]*\(site_slug\)/i);
  assert.match(sql, /alter table public\.connect_push_subscriptions enable row level security/i);
  assert.match(sql, /revoke all on table public\.connect_push_subscriptions from anon, authenticated/i);
  assert.match(sql, /revoke all on sequence public\.connect_push_subscriptions_id_seq from anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.connect_push_subscriptions to service_role/i);
});

test("quote ingest keeps best-effort push alive after its HTTP response", () => {
  const source = fs.readFileSync(quoteRequestPath, "utf8");
  assert.match(source, /require\(["']@vercel\/functions["']\)/);
  assert.match(source, /sendConnectPush\s*\(\s*\{/);
  assert.match(source, /waitUntil\s*\(\s*pushTask\s*\)/);
  assert.match(source, /pushTask[\s\S]*?\.catch\s*\(/, "push failure must stay outside the ingest failure path");
  assert.match(source, /return Promise\.resolve\(\)\.then\(\(\) => recordEvent\("connect_push_failed"/);
  assert.doesNotMatch(source, /connect_push_failed[\s\S]{0,180}\berror\s*:/, "capability-bearing provider errors never enter the event payload");
});

// --- The page half: the welded v2 adapter -----------------------------------
//
// The v1 single-file app owned the whole push flow inside its UI closure
// (notifybtn, pushState, iosDevice guidance). The v2 redesign moved the flow
// into the CONNECT_DATA adapter: registerPush(true) is called by the UI's
// Settings toggle and performs GET key -> permission -> subscribe -> POST.
// The safety property (4) is unchanged — the permission prompt exists only
// downstream of the person's own toggle action — so these tests exercise the
// adapter seam directly, exactly the way the UI drives it.
//
// RETIRED: the v1 "#notifybtn" click path and the
// iosDevice()/pushSupported() source-order assertion — both pinned removed v1
// UI internals. The iPhone guidance survives as the adapter's honest refusal
// when Push APIs are missing (tested below); the deliberate-language check
// now pins the v2 Settings copy.

const {
  bootAdapter: bootV2Adapter,
  readPage: readV2Page,
} = require("./fixtures/connect-v2-adapter-harness.js");

test("notification permission is requested only after the owner's own toggle action", async () => {
  const token = "tenant-token-for-page-proof";
  const page = await bootV2Adapter({
    token,
    notificationPermission: "default",
    permissionAnswer: "granted",
    routes: {
      "/push-subscribe": (_url, init, answer) => {
        if (String(init.method || "GET").toUpperCase() === "POST") return answer({ ok: true });
        return answer({ ok: true, configured: true, publicKey: keys.publicKey, scope: "tenant" });
      },
    },
  });
  assert.match(page.page.html, /New lead alerts/i, "the Settings toggle uses plain, deliberate language");
  assert.equal(page.permissionRequests(), 0, "loading and authenticating the app must never open a permission prompt");

  const result = await page.adapter.registerPush(true);
  assert.equal(page.permissionRequests(), 1, "one deliberate toggle creates one permission request");
  // The adapter's objects come from the vm realm, so compare values not prototypes.
  assert.equal(result.enabled, true);

  const pushCalls = page.calls.filter((call) => call.url.endsWith("/push-subscribe"));
  assert.equal(String(pushCalls[0].init.method || "GET").toUpperCase(), "GET", "the server names the VAPID key before anything else");
  assert.equal(pushCalls[0].init.headers["x-connect-token"], token);

  assert.equal(page.subscribeOptions.length, 1, "the browser mints exactly one subscription");
  assert.equal(page.subscribeOptions[0].userVisibleOnly, true);
  const keyBytes = page.subscribeOptions[0].applicationServerKey;
  assert.equal(keyBytes.length, Buffer.from(keys.publicKey, "base64url").length, "the applicationServerKey is the server's decoded VAPID key");
  assert.equal(Buffer.from(keyBytes).toString("base64url"), keys.publicKey);

  const post = pushCalls.find((call) => String(call.init.method).toUpperCase() === "POST");
  assert.ok(post, "a granted permission is followed by the authenticated subscription write");
  assert.equal(post.init.headers["x-connect-token"], token);
  const body = JSON.parse(String(post.init.body));
  assert.ok(body.subscription && body.subscription.endpoint, "the stored payload is the browser's own subscription");
});

test("a shared full-scope token is refused before any permission prompt can appear", async () => {
  const page = await bootV2Adapter({
    notificationPermission: "default",
    routes: {
      "/push-subscribe": (_url, _init, answer) =>
        answer({ ok: true, configured: true, publicKey: keys.publicKey, scope: "full" }),
    },
  });
  await assert.rejects(() => page.adapter.registerPush(true), /personal Client ID/i);
  assert.equal(page.permissionRequests(), 0, "a token that can never bind a device must not cost a permission prompt");
  assert.equal(page.subscribeOptions.length, 0);
});

test("denied permission stays off, and a pushless browser gets the honest iPhone guidance", async () => {
  const denied = await bootV2Adapter({
    notificationPermission: "default",
    permissionAnswer: "denied",
  });
  const result = await denied.adapter.registerPush(true);
  assert.equal(result.enabled, false, "a denied prompt is reported as off, never retried into");
  assert.equal(denied.subscribeOptions.length, 0);
  assert.equal(
    denied.calls.some((call) => call.url.endsWith("/push-subscribe") && String(call.init.method).toUpperCase() === "POST"),
    false,
    "no subscription write without a granted permission",
  );

  const pushless = await bootV2Adapter({ withPushManager: false });
  await assert.rejects(() => pushless.adapter.registerPush(true), /Home Screen/i);
  assert.equal(pushless.permissionRequests(), 0);
});

test("the adapter parses standalone and installs before the UI IIFE", () => {
  const { adapterSource } = readV2Page();
  new vm.Script(adapterSource, { filename: "wss-connect-adapter.js" });
  assert.match(adapterSource, /window\.CONNECT_DATA\s*=/, "the adapter installs the real CONNECT_DATA");
});
