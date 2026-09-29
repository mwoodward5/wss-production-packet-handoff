"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function responseRecorder() {
  return {
    headers: {}, statusCode: 0, body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = "") { this.body = String(value); return this; },
  };
}

function fresh(path) {
  delete require.cache[require.resolve(path)];
  return require(path);
}

test("calendar status rejects unauthenticated callers before exposing connection state", async () => {
  const prior = process.env.CONNECT_CALENDAR_BOOKING_ENABLED;
  process.env.CONNECT_CALENDAR_BOOKING_ENABLED = "true";
  try {
    const handler = fresh("../api/connect/calendar/status");
    const res = responseRecorder();
    await handler({ method: "GET", headers: {}, url: "/api/connect/calendar/status", query: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "unauthorized" });
  } finally {
    if (prior === undefined) delete process.env.CONNECT_CALENDAR_BOOKING_ENABLED;
    else process.env.CONNECT_CALENDAR_BOOKING_ENABLED = prior;
  }
});

test("book endpoint never labels errors as booked", async () => {
  const handler = fresh("../api/connect/calendar/book");
  const res = responseRecorder();
  await handler({ method: "GET", headers: {}, url: "/api/connect/calendar/book", query: {} }, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 405);
  assert.equal(payload.booked, false);
  assert.equal(payload.ok, false);
});

test("callback cancellation returns only an app error fragment", async () => {
  const handler = fresh("../api/connect/calendar/callback");
  const res = responseRecorder();
  await handler({ method: "GET", query: { error: "access_denied" } }, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/connect\.wss-labs\.com\/#connect_error=/);
  assert.equal(res.headers.location.includes("access_token"), false);
});

test("connectors status flag OFF preserves existing channels and makes no calendar provider call", async () => {
  const oldFlag = process.env.CONNECT_CALENDAR_BOOKING_ENABLED;
  const oldToken = process.env.CONNECT_APP_TOKEN;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldFetch = global.fetch;
  process.env.CONNECT_CALENDAR_BOOKING_ENABLED = "false";
  process.env.CONNECT_APP_TOKEN = "test-admin-token";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    assert.match(String(url), /\/rest\/v1\/connect_connectors/);
    return new Response(JSON.stringify([
      { platform: "facebook", is_active: true, account_name: "Acme Page", access_token: "must-not-leak", metadata: { refresh_token: "must-not-leak" } },
      { platform: "linkedin", is_active: false, account_name: "Acme Member" },
      { platform: "unknown", is_active: true, account_name: "Ignore" },
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const handler = fresh("../api/connect/connectors/status");
    const res = responseRecorder();
    await handler({ method: "GET", headers: { "x-connect-token": "test-admin-token" }, url: "/api/connect/connectors/status?slug=acme-roofing", query: { slug: "acme-roofing" } }, res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.siteSlug, "acme-roofing");
    assert.deepEqual(payload.facebook_messenger, { connected: true, accountName: "Acme Page" });
    assert.deepEqual(payload.connectors.facebook_messenger, payload.facebook_messenger);
    assert.deepEqual(payload.connectors.linkedin_dm, { connected: false, accountName: "Acme Member" });
    assert.equal(res.body.includes("google_calendar"), false);
    assert.equal(res.body.includes("must-not-leak"), false);
    assert.equal(calls.length, 1, "only the normal connector-store read runs");
  } finally {
    if (oldFlag === undefined) delete process.env.CONNECT_CALENDAR_BOOKING_ENABLED; else process.env.CONNECT_CALENDAR_BOOKING_ENABLED = oldFlag;
    if (oldToken === undefined) delete process.env.CONNECT_APP_TOKEN; else process.env.CONNECT_APP_TOKEN = oldToken;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
    global.fetch = oldFetch;
  }
});

test("connector status sanitizer maps supported channels and omits secrets", () => {
  const handler = fresh("../api/connect/connectors/status");
  const safe = handler._test.safeExistingConnectors([
    { platform: "instagram", is_active: true, account_name: "Acme IG", access_token: "secret" },
    { platform: "tiktok", is_active: true, account_name: "Acme TT", metadata: { refresh_token: "secret" } },
  ]);
  assert.deepEqual(safe, {
    instagram_dm: { connected: true, accountName: "Acme IG" },
    tiktok_dm: { connected: true, accountName: "Acme TT" },
  });
  assert.equal(JSON.stringify(safe).includes("secret"), false);
});
