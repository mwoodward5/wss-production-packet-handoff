"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const routePath = require.resolve("../api/connect/voice-config");
const storePath = require.resolve("../lib/store");
const connectPath = require.resolve("../lib/connect");

const OWN_SLUG = "tenant-one";
const OTHER_SLUG = "tenant-two";
const PUBLIC_KEY = "pk_browser_safe_0123456789";
const ASSISTANT_ID = "5b5e73a3-2bd7-4777-8233-077bf7ffddc6";
const SERVER_SECRET = "server-secret-must-never-leave";
const BUSINESS_NAME = "Tenant One Plumbing";
const CLIENT_ID = "WSS-CLIENT-ONE";
const PROSPECT_ID = "prospect-one";
const SITE_URL = `https://${OWN_SLUG}.wss-ai.com/`;

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value) { this.body = String(value == null ? "" : value); },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function withRoute({ scope, select, env = {} }, run) {
  const priorStore = require.cache[storePath];
  const priorConnect = require.cache[connectPath];
  const priorRoute = require.cache[routePath];
  const envNames = [
    "VAPI_DASHBOARD_VOICE_ENABLED",
    "VAPI_PUBLIC_KEY",
    "VAPI_PUBLIC_ASSISTANT_ID",
    "VAPI_RILEY_ASSISTANT_ID",
    "VAPI_LOCAL_GROWTH_ASSISTANT_ID",
    "VAPI_API_KEY",
    "VAPI_PRIVATE_KEY",
  ];
  const priorEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));

  for (const name of envNames) delete process.env[name];
  Object.assign(process.env, { VAPI_DASHBOARD_VOICE_ENABLED: "true" }, env);
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: { select },
  };
  require.cache[connectPath] = {
    id: connectPath,
    filename: connectPath,
    loaded: true,
    exports: { resolveConnectScope: () => scope },
  };
  delete require.cache[routePath];

  try {
    return await run(require(routePath));
  } finally {
    if (priorStore) require.cache[storePath] = priorStore; else delete require.cache[storePath];
    if (priorConnect) require.cache[connectPath] = priorConnect; else delete require.cache[connectPath];
    if (priorRoute) require.cache[routePath] = priorRoute; else delete require.cache[routePath];
    for (const name of envNames) restoreEnv(name, priorEnv[name]);
  }
}

function liveAccess(slug = OWN_SLUG, businessName = BUSINESS_NAME) {
  return {
    ok: true,
    mode: "live_select",
    data: [{
      site_slug: slug,
      job_id: `prospect-${PROSPECT_ID}`,
      business_name: businessName,
    }],
  };
}

function liveProspects(rows = [{
  prospect_id: PROSPECT_ID,
  business_name: BUSINESS_NAME,
  preview_url: SITE_URL,
  report_url: null,
  record: { reference: CLIENT_ID },
}]) {
  return { ok: true, mode: "live_select", data: rows };
}

function boundSelect() {
  return async (table) => {
    if (table === "ghost_agency_dashboard_access") return liveAccess();
    if (table === "ghost_agency_prospects") return liveProspects();
    throw new Error(`unexpected table: ${table}`);
  };
}

test("unauthorized and shared-admin callers cannot read browser voice config", async () => {
  for (const [scope, expectedStatus, expectedError] of [
    [null, 401, "unauthorized"],
    [{ mode: "full" }, 403, "tenant_scope_required"],
  ]) {
    let reads = 0;
    await withRoute({
      scope,
      select: async () => { reads += 1; return liveAccess(); },
      env: { VAPI_PUBLIC_KEY: PUBLIC_KEY, VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
    }, async (handler) => {
      const res = mockRes();
      await handler({ method: "GET", headers: {}, query: {} }, res);
      assert.equal(res.statusCode, expectedStatus);
      assert.deepEqual(JSON.parse(res.body), { ok: false, error: expectedError });
      assert.equal(res.headers["cache-control"], "no-store");
      assert.equal(reads, 0, "a caller without tenant identity must not touch storage");
    });
  }
});

test("tenant ownership comes only from the signed scope and is revalidated", async () => {
  const queries = [];
  const readBoundTenant = boundSelect();
  await withRoute({
    scope: { mode: "tenant", siteSlug: OWN_SLUG },
    select: async (table, query) => {
      queries.push({ table, query });
      return readBoundTenant(table, query);
    },
    env: { VAPI_PUBLIC_KEY: PUBLIC_KEY, VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
  }, async (handler) => {
    const res = mockRes();
    await handler({
      method: "GET",
      headers: {},
      query: { slug: OTHER_SLUG },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
      publicKey: PUBLIC_KEY,
      assistantId: ASSISTANT_ID,
      metadata: {
        site_slug: OWN_SLUG,
        client_id: CLIENT_ID,
        business_name: BUSINESS_NAME,
      },
    });
    assert.equal(queries.length, 3);
    assert.equal(queries[0].table, "ghost_agency_dashboard_access");
    assert.match(queries[0].query, new RegExp(`site_slug=eq\\.${OWN_SLUG}`));
    for (const { query } of queries) assert.doesNotMatch(query, new RegExp(OTHER_SLUG));
  });

  await withRoute({
    scope: { mode: "tenant", siteSlug: OWN_SLUG },
    // Even a broken/malicious storage adapter returning another tenant's row
    // cannot turn that row into a successful browser config response.
    select: async () => liveAccess(OTHER_SLUG),
    env: { VAPI_PUBLIC_KEY: PUBLIC_KEY, VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
  }, async (handler) => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "site_not_found" });
  });

  await withRoute({
    scope: { mode: "tenant", siteSlug: OWN_SLUG },
    select: async (table) => (
      table === "ghost_agency_dashboard_access" ? liveAccess() : liveProspects([])
    ),
    env: { VAPI_PUBLIC_KEY: PUBLIC_KEY, VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
  }, async (handler) => {
    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "tenant_metadata_unavailable" });
    assert.doesNotMatch(res.body, new RegExp(PUBLIC_KEY));
  });
});

test("the GET contract is frozen, minimal, no-store, and contains no server secret", async () => {
  await withRoute({
    scope: { mode: "tenant", siteSlug: OWN_SLUG },
    select: boundSelect(),
    env: {
      VAPI_PUBLIC_KEY: PUBLIC_KEY,
      VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID,
      VAPI_API_KEY: SERVER_SECRET,
      VAPI_PRIVATE_KEY: `private-${SERVER_SECRET}`,
    },
  }, async (handler) => {
    const helperConfig = handler._test.browserVoiceConfig({
      VAPI_DASHBOARD_VOICE_ENABLED: "true",
      VAPI_PUBLIC_KEY: PUBLIC_KEY,
      VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID,
      VAPI_API_KEY: SERVER_SECRET,
      VAPI_PRIVATE_KEY: `private-${SERVER_SECRET}`,
    });
    assert.equal(Object.isFrozen(helperConfig), true);
    assert.deepEqual(Object.keys(helperConfig).sort(), ["assistantId", "publicKey"]);

    const binding = await handler._test.tenantMetadata(OWN_SLUG, boundSelect());
    assert.equal(binding.ok, true);
    assert.equal(Object.isFrozen(binding.metadata), true);
    assert.deepEqual(Object.keys(binding.metadata).sort(), ["business_name", "client_id", "site_slug"]);

    const res = mockRes();
    await handler({ method: "GET", headers: {}, query: {} }, res);
    const body = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers.pragma, "no-cache");
    assert.deepEqual(Object.keys(body).sort(), ["assistantId", "metadata", "publicKey"]);
    assert.deepEqual(body.metadata, {
      site_slug: OWN_SLUG,
      client_id: CLIENT_ID,
      business_name: BUSINESS_NAME,
    });
    assert.doesNotMatch(res.body, new RegExp(SERVER_SECRET));
    assert.doesNotMatch(res.body, /private-/i);
  });
});

test("missing or malformed public config fails closed without a partial value", async () => {
  for (const env of [
    {},
    { VAPI_PUBLIC_KEY: PUBLIC_KEY },
    { VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
    { VAPI_PUBLIC_KEY: "has spaces", VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
  ]) {
    await withRoute({
      scope: { mode: "tenant", siteSlug: OWN_SLUG },
      select: boundSelect(),
      env,
    }, async (handler) => {
      const res = mockRes();
      await handler({ method: "GET", headers: {}, query: {} }, res);
      assert.equal(res.statusCode, 503);
      assert.deepEqual(JSON.parse(res.body), { ok: false, error: "voice_not_configured" });
      assert.doesNotMatch(res.body, new RegExp(PUBLIC_KEY));
      assert.doesNotMatch(res.body, new RegExp(ASSISTANT_ID));
    });
  }
});

test("a public key cannot enable customer voice without the explicit release gate", async () => {
  const route = require(routePath);
  assert.equal(route._test.browserVoiceConfig({
    VAPI_PUBLIC_KEY: PUBLIC_KEY,
    VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID,
  }), null);
  assert.equal(route._test.browserVoiceConfig({
    VAPI_DASHBOARD_VOICE_ENABLED: "false",
    VAPI_PUBLIC_KEY: PUBLIC_KEY,
    VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID,
  }), null);
});

test("storage failures and non-GET methods fail closed", async () => {
  await withRoute({
    scope: { mode: "tenant", siteSlug: OWN_SLUG },
    select: async () => ({ ok: false, mode: "live_select_failed", data: [] }),
    env: { VAPI_PUBLIC_KEY: PUBLIC_KEY, VAPI_PUBLIC_ASSISTANT_ID: ASSISTANT_ID },
  }, async (handler) => {
    const failedRead = mockRes();
    await handler({ method: "GET", headers: {}, query: {} }, failedRead);
    assert.equal(failedRead.statusCode, 503);
    assert.deepEqual(JSON.parse(failedRead.body), { ok: false, error: "tenant_validation_unavailable" });

    const post = mockRes();
    await handler({ method: "POST", headers: {}, query: {} }, post);
    assert.equal(post.statusCode, 405);
    assert.deepEqual(JSON.parse(post.body), { ok: false, error: "method_not_allowed" });
    assert.equal(post.headers["cache-control"], "no-store");
  });
});

test("the route source does not read or log a server provider credential", () => {
  const source = fs.readFileSync(path.join(__dirname, "../api/connect/voice-config.js"), "utf8");
  assert.doesNotMatch(source, /VAPI_API_KEY|VAPI_PRIVATE_KEY/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error|debug)/);
});
