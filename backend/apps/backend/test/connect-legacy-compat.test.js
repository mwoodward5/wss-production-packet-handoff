"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function responseRecorder() {
  return {
    headers: {},
    statusCode: 0,
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = "") { this.body = String(value); return this; },
  };
}

function fresh(path) {
  delete require.cache[require.resolve(path)];
  return require(path);
}

function saveEnv(names) {
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  return () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

const ENV_NAMES = [
  "CONNECT_APP_TOKEN",
  "GHOST_AGENCY_ADMIN_TOKEN",
  "GHOST_AGENCY_API_URL",
  "META_APP_ID",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

test("legacy provider registry aliases Messenger to the Facebook row without inventing providers", () => {
  const registry = fresh("../lib/connect-legacy-connectors");
  const messenger = registry.resolveLegacyConnector("facebook_messenger");
  assert.equal(messenger.provider, "facebook");
  assert.equal(messenger.storagePlatform, "facebook");
  assert.equal(messenger.channel, "facebook_messenger");
  assert.equal(registry.resolveLegacyConnector("google_voice"), null);
  assert.equal(
    registry.callbackUri(messenger, { GHOST_AGENCY_API_URL: "https://ghost.example.test/path" }),
    "https://ghost.example.test/api/connect/connectors/facebook_messenger/callback",
  );
});

test("legacy connector status remains protected", async () => {
  const restore = saveEnv(ENV_NAMES);
  delete process.env.CONNECT_APP_TOKEN;
  delete process.env.GHOST_AGENCY_ADMIN_TOKEN;
  try {
    const handler = fresh("../api/connect/connectors/[platform]/status");
    const res = responseRecorder();
    await handler({
      method: "GET",
      headers: {},
      url: "/api/connect/connectors/facebook/status?slug=acme-roofing",
      query: { platform: "facebook", slug: "acme-roofing" },
    }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "unauthorized" });
  } finally {
    restore();
  }
});

test("legacy auth returns JSON with one exact callback URI for Messenger", async () => {
  const restore = saveEnv(ENV_NAMES);
  const oldFetch = global.fetch;
  process.env.CONNECT_APP_TOKEN = "test-connect-token";
  process.env.GHOST_AGENCY_API_URL = "https://ghost.example.test";
  process.env.META_APP_ID = "meta-app-id";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  const writes = [];
  global.fetch = async (url, init = {}) => {
    writes.push({ url: String(url), init });
    assert.match(String(url), /\/rest\/v1\/connect_oauth_states$/);
    assert.equal(init.method, "POST");
    return new Response(JSON.stringify([{ state: "stored" }]), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const handler = fresh("../api/connect/connectors/[platform]/auth");
    const res = responseRecorder();
    await handler({
      method: "GET",
      headers: { "x-connect-token": "test-connect-token" },
      url: "/api/connect/connectors/messenger/auth?slug=acme-roofing",
      query: { platform: "messenger", slug: "acme-roofing" },
    }, res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.provider, "facebook");
    assert.equal(payload.channel, "facebook_messenger");
    assert.equal(payload.callbackUrl, "https://ghost.example.test/api/connect/connectors/messenger/callback");
    assert.equal(payload.authorizationUrl, payload.authUrl);
    const auth = new URL(payload.authUrl);
    assert.equal(auth.hostname, "www.facebook.com");
    assert.equal(auth.searchParams.get("redirect_uri"), payload.callbackUrl);
    const stateWrite = JSON.parse(writes[0].init.body);
    assert.equal(stateWrite.redirect_uri, payload.callbackUrl);
    assert.equal(stateWrite.site_slug, "acme-roofing");
    assert.equal(stateWrite.platform, "facebook");
  } finally {
    global.fetch = oldFetch;
    restore();
  }
});

test("unsupported legacy connector returns explicit not implemented after authorization", async () => {
  const restore = saveEnv(ENV_NAMES);
  process.env.CONNECT_APP_TOKEN = "test-connect-token";
  try {
    const handler = fresh("../api/connect/connectors/[platform]/auth");
    const res = responseRecorder();
    await handler({
      method: "GET",
      headers: { "x-connect-token": "test-connect-token" },
      url: "/api/connect/connectors/google_voice/auth?slug=acme-roofing",
      query: { platform: "google_voice", slug: "acme-roofing" },
    }, res);
    assert.equal(res.statusCode, 501);
    assert.deepEqual(JSON.parse(res.body), {
      ok: false,
      error: "connector_not_implemented",
      platform: "google_voice",
    });
  } finally {
    restore();
  }
});

test("Messenger status reads the Facebook provider row and never exposes tokens", async () => {
  const restore = saveEnv(ENV_NAMES);
  const oldFetch = global.fetch;
  process.env.CONNECT_APP_TOKEN = "test-connect-token";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(init.method, "GET");
    assert.equal(parsed.searchParams.get("site_slug"), "eq.acme-roofing");
    assert.equal(parsed.searchParams.get("platform"), "eq.facebook");
    return new Response(JSON.stringify([{
      platform: "facebook",
      is_active: true,
      account_name: "Acme Page",
      access_token: "must-not-leak",
    }]), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const handler = fresh("../api/connect/connectors/[platform]/status");
    const res = responseRecorder();
    await handler({
      method: "GET",
      headers: { "x-connect-token": "test-connect-token" },
      url: "/api/connect/connectors/messenger/status?slug=acme-roofing",
      query: { platform: "messenger", slug: "acme-roofing" },
    }, res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.connected, true);
    assert.equal(payload.accountName, "Acme Page");
    assert.deepEqual(payload.connector, { connected: true, accountName: "Acme Page" });
    assert.deepEqual(payload.facebook_messenger, payload.connector);
    assert.equal(res.body.includes("must-not-leak"), false);
  } finally {
    global.fetch = oldFetch;
    restore();
  }
});

test("DELETE Messenger removes only the scoped Facebook row", async () => {
  const restore = saveEnv(ENV_NAMES);
  const oldFetch = global.fetch;
  process.env.CONNECT_APP_TOKEN = "test-connect-token";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  global.fetch = async (url, init = {}) => {
    const parsed = new URL(String(url));
    assert.equal(init.method, "DELETE");
    assert.equal(parsed.pathname, "/rest/v1/connect_connectors");
    assert.equal(parsed.searchParams.get("site_slug"), "eq.acme-roofing");
    assert.equal(parsed.searchParams.get("platform"), "eq.facebook");
    return new Response(JSON.stringify([{ site_slug: "acme-roofing", platform: "facebook" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const handler = fresh("../api/connect/connectors/[platform]");
    const res = responseRecorder();
    await handler({
      method: "DELETE",
      headers: { "x-connect-token": "test-connect-token" },
      url: "/api/connect/connectors/messenger?slug=acme-roofing",
      query: { platform: "messenger", slug: "acme-roofing" },
    }, res);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.disconnected, true);
    assert.equal(payload.deleted, 1);
    assert.equal(payload.provider, "facebook");
  } finally {
    global.fetch = oldFetch;
    restore();
  }
});

test("legacy callback cancellation returns only a safe app fragment", async () => {
  const handler = fresh("../api/connect/connectors/[platform]/callback");
  const res = responseRecorder();
  await handler({
    method: "GET",
    query: { platform: "instagram", error: "access_denied" },
  }, res);
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/connect\.wss-labs\.com\/#connect_error=/);
  assert.equal(res.headers.location.includes("access_token"), false);
});
