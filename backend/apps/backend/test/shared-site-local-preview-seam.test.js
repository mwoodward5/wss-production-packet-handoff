"use strict";

// LOCAL PREVIEW SEAM — WSS_SHARED_SITE_ENV=local.
//
// Every local mirror build used to die terminally at preview verification:
// openPreview minted a grant with the LOCAL secret/registry, then exchanged it
// against https://<slug>.wss-ai.com — the PRODUCTION router — which validates
// with the production secret, production environment, and production grant
// registry. Structurally impossible to pass, and every attempt performed a
// real Vercel domain-attach on the production router project.
//
// The seam (lib/shared-site-release.js localSiteGatewayOrigin +
// lib/shared-site-host-provisioner.js LOCAL_DOMAIN_ATTACH) redirects the
// preview-exchange leg to the local site-router gateway and skips the
// production attach under the local environment only. These tests pin both
// directions: local behaves local, and every other environment keeps the
// exact production bytes.

const assert = require("node:assert/strict");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { test, describe } = require("node:test");

const {
  createSharedSitePublisher,
} = require("../lib/shared-site-publisher");
const {
  LOCAL_DOMAIN_ATTACH,
  ROUTER_PROJECT_ID,
  createVercelSharedSiteHostProvisioner,
} = require("../lib/shared-site-host-provisioner");
const {
  LOCAL_SITE_BASE_DOMAIN,
  LOCAL_SITE_GATEWAY_PORT,
  isLocalSharedSiteEnvironment,
  localSiteGatewayOrigin,
} = require("../lib/shared-site-release");
const { verifyPreviewGrant } = require("../lib/shared-site-preview");
const { createRouterApplication } = require("../../site-router/lib/application");
const { verifyPreviewSession } = require("../../site-router/lib/token");

const SITE_ID = "22222222-2222-4222-8222-222222222222";
const BUILD_HASH = "b".repeat(64);
const SLUG = "acme-plumbing";
const HOST = `${SLUG}.wss-ai.com`;
const LOCAL_ORIGIN = `https://${SLUG}.${LOCAL_SITE_BASE_DOMAIN}:${LOCAL_SITE_GATEWAY_PORT}`;
const PREVIEW_SECRET = "local-seam-preview-secret-at-least-32-bytes";
const LOCAL_ENV = Object.freeze({
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SITE_ALLOWLIST: SLUG,
  WSS_SHARED_SITE_ENV: "local",
  WSS_SITE_PREVIEW_SECRET: PREVIEW_SECRET,
});
// The existing publisher suite's environment ("test") — any non-local value
// must keep production behavior byte-identical.
const NONLOCAL_ENV = Object.freeze({
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SITE_ALLOWLIST: SLUG,
  WSS_SHARED_SITE_ENV: "test",
  WSS_SITE_PREVIEW_SECRET: PREVIEW_SECRET,
});

function files() {
  return {
    "index.html": Buffer.from("<!doctype html><p>local seam fixture</p>"),
  };
}

function publisherInput(overrides = {}) {
  return {
    slug: SLUG,
    host: HOST,
    files: files(),
    routeMap: { "/": "index.html" },
    buildHash: BUILD_HASH,
    operationKey: "line:seam:prospect:build",
    ...overrides,
  };
}

function fakeRegistry() {
  return {
    async ensureSiteIdentity({ slug, host }) {
      return { ok: true, site_id: SITE_ID, canonical_slug: slug, canonical_host: host, generation: 0 };
    },
    async readSiteGeneration({ slug, host }) {
      return {
        ok: true,
        site_id: SITE_ID,
        canonical_slug: slug,
        canonical_host: host,
        generation: 0,
      };
    },
    async insertStagedRelease() {
      return { ok: true, state: "staged" };
    },
    async markReleaseVerified() {
      return { ok: true, state: "verified" };
    },
    async activateReleaseCas() {
      throw new Error("fixture_never_activates");
    },
    async rollbackReleaseCas() {
      throw new Error("fixture_never_rolls_back");
    },
    async quarantineReleaseCas() {
      throw new Error("fixture_never_quarantines");
    },
    async registerPreviewGrant() {
      return { ok: true };
    },
  };
}

function memoryStorage() {
  const objects = new Map();
  return {
    async readObject({ key }) {
      return objects.has(key)
        ? { ok: true, found: true, body: Buffer.from(objects.get(key)) }
        : { ok: true, found: false };
    },
    async putObjectIfAbsent({ key, body, insertOnly }) {
      assert.equal(insertOnly, true);
      if (objects.has(key)) return { ok: false, exists: true, reason: "object_exists" };
      objects.set(key, Buffer.from(body));
      return { ok: true, inserted: true };
    },
  };
}

const PUBLIC_OK = async () => ({ ok: true, fallback: false, routes: ["/"] });
// The exact receipt the local provisioner records (skip, zero provider I/O).
const LOCAL_HOST_OK = async ({ host }) => Object.freeze({
  ok: true,
  host,
  domainAttach: LOCAL_DOMAIN_ATTACH,
});
// The exact receipt the production provisioner returns.
const PROD_HOST_OK = async ({ host }) => Object.freeze({
  ok: true,
  host,
  projectId: ROUTER_PROJECT_ID,
});

function localPublisher({ previewFetch, registry = fakeRegistry() } = {}) {
  return createSharedSitePublisher({
    registry,
    storage: memoryStorage(),
    env: LOCAL_ENV,
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: LOCAL_HOST_OK,
    ...(previewFetch ? { previewFetch } : {}),
  });
}

function grantClaims(grantToken) {
  const [payload] = String(grantToken).split(".");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// ---------------------------------------------------------------------------
// (0) pure seam helpers
// ---------------------------------------------------------------------------

test("local seam helpers answer only for the exact local environment", () => {
  assert.equal(isLocalSharedSiteEnvironment(LOCAL_ENV), true);
  assert.equal(isLocalSharedSiteEnvironment({ WSS_SHARED_SITE_ENV: "local " }), false);
  assert.equal(isLocalSharedSiteEnvironment({ WSS_SHARED_SITE_ENV: "Local" }), false);
  assert.equal(isLocalSharedSiteEnvironment({ WSS_SHARED_SITE_ENV: "production" }), false);
  // An explicitly set variable decides (production pulls carry the empty
  // string) — an unset one is covered by the local-default assertions below.
  assert.equal(isLocalSharedSiteEnvironment({ WSS_SHARED_SITE_ENV: "" }), false);

  assert.equal(localSiteGatewayOrigin(SLUG, LOCAL_ENV), LOCAL_ORIGIN);
  assert.equal(localSiteGatewayOrigin(SLUG, NONLOCAL_ENV), "");
  assert.equal(localSiteGatewayOrigin("Not_A_Slug", LOCAL_ENV), "");
});

test("local-by-default: an environment with no shared-site variable and no Vercel credentials serves locally", () => {
  // LOCAL-BY-DEFAULT (independence): a stack that cannot reach Vercel is
  // local without being told. ANY Vercel credential present means the
  // deployment intends production and must be fully configured — the
  // historic fail-closed contract for partial credentials is preserved.
  assert.equal(isLocalSharedSiteEnvironment({}), true);
  assert.equal(isLocalSharedSiteEnvironment({ VERCEL: "1" }), false);
  assert.equal(isLocalSharedSiteEnvironment({ VERCEL_TOKEN: "x".repeat(10) }), false);
  assert.equal(
    isLocalSharedSiteEnvironment({ VERCEL_TOKEN: "x".repeat(10), VERCEL_TEAM_ID: "team_abc" }),
    false,
  );
  assert.equal(isLocalSharedSiteEnvironment({ WSS_SHARED_SITE_ENV: "", VERCEL_TOKEN: "x".repeat(10), VERCEL_TEAM_ID: "team_abc" }), false);
});

// ---------------------------------------------------------------------------
// (a) local-env unit: the exchange URL resolves to the local router origin
// ---------------------------------------------------------------------------

test("under the local environment openPreview exchanges against the local gateway origin", async () => {
  const exchanges = [];
  const previewRequests = [];
  const publisher = localPublisher({
    previewFetch(url, options) {
      if (String(url).endsWith("/api/preview-session")) {
        exchanges.push({ url: String(url), options });
        return {
          ok: true,
          status: 204,
          url: String(url),
          headers: {
            getSetCookie() {
              return [`__Host-wss-site-preview=session_payload.session_signature; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Strict`];
            },
          },
        };
      }
      previewRequests.push({ url: String(url), options });
      return { ok: true, status: 200, url: String(url), headers: { get() { return null; } } };
    },
  });

  const staged = await publisher.stage(publisherInput());
  assert.equal(staged.ok, true, JSON.stringify(staged));
  const session = await staged.openPreview();

  assert.equal(session.origin, LOCAL_ORIGIN);
  assert.equal(exchanges.length, 1);
  assert.equal(exchanges[0].url, `${LOCAL_ORIGIN}/api/preview-session`);
  assert.notEqual(exchanges[0].url, `https://${HOST}/api/preview-session`);

  // The minted grant must itself be a LOCAL grant: local env claim, local
  // slug, verifiable with the same (local) secret configuration the local
  // router runs under.
  const claims = grantClaims(JSON.parse(exchanges[0].options.body).grant);
  assert.equal(claims.env, "local");
  assert.equal(claims.slug, SLUG);
  assert.equal(claims.aud, "wss-site-router-preview");
  assert.equal(verifyPreviewGrant(JSON.parse(exchanges[0].options.body).grant, { env: LOCAL_ENV }).ok, true);

  // Every cookie-bound preview fetch is pinned to the local origin too — the
  // production canonical host is cross-origin and refused.
  await session.fetch("/services?preview=1");
  assert.equal(previewRequests[0].url, `${LOCAL_ORIGIN}/services?preview=1`);
  await assert.rejects(
    () => session.fetch(`https://${HOST}/services`),
    /shared_preview_cross_origin_refused/,
  );
});

// ---------------------------------------------------------------------------
// (b) provisioner: the local environment records the skip, zero provider I/O
// ---------------------------------------------------------------------------

test("local provisioner skips the production attach with a recorded reason and no credentials", async () => {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    throw new Error("must_not_touch_any_provider_under_local_env");
  };

  // No VERCEL_TOKEN at all — the local compose stack has none — and the skip
  // still happens before any credential requirement.
  const localOnly = createVercelSharedSiteHostProvisioner({
    env: { WSS_SHARED_SITE_ENV: "local" },
    fetchImpl,
    wait: async () => {},
  });
  const receipt = await localOnly({ host: HOST });
  assert.deepEqual(receipt, {
    ok: true,
    host: HOST,
    domainAttach: "domain_attach_skipped:local_env",
  });
  assert.equal(Object.isFrozen(receipt), true);

  // Even with production credentials present, the local environment attaches
  // to nothing.
  const withToken = createVercelSharedSiteHostProvisioner({
    env: { ...LOCAL_ENV, VERCEL_TOKEN: "vercel-token-present", VERCEL_TEAM_ID: "team_wsstest" },
    fetchImpl,
    wait: async () => {},
  });
  assert.deepEqual(await withToken({ host: HOST }), receipt);
  assert.equal(calls.length, 0);
});

test("outside the local environment the attach path stays exactly production", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push(String(url));
    throw new Error("shared_site_host_configuration_required_expected");
  };
  // A non-local WSS_SHARED_SITE_ENV without credentials still demands the
  // Vercel configuration — the seam did not loosen the production gate.
  const ensure = createVercelSharedSiteHostProvisioner({
    env: { WSS_SHARED_SITE_ENV: "production " }, // whitespace: not the exact local value
    fetchImpl,
    wait: async () => {},
  });
  await assert.rejects(() => ensure({ host: HOST }), /shared_site_host_configuration_required/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// (c) production identity: non-local environments keep the exact legacy gate
// ---------------------------------------------------------------------------

test("non-local publisher keeps the canonical origin and the exact project gate", async () => {
  const exchanges = [];
  const publisher = createSharedSitePublisher({
    registry: fakeRegistry(),
    storage: memoryStorage(),
    env: NONLOCAL_ENV,
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: PROD_HOST_OK,
    previewFetch(url) {
      exchanges.push(String(url));
      return {
        ok: true,
        status: 204,
        url: String(url),
        headers: {
          getSetCookie() {
            return [`__Host-wss-site-preview=payload.signature; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Strict`];
          },
        },
      };
    },
  });

  const staged = await publisher.stage(publisherInput());
  const session = await staged.openPreview();
  assert.equal(session.origin, `https://${HOST}`);
  assert.deepEqual(exchanges, [`https://${HOST}/api/preview-session`]);
});

test("non-local publisher still refuses a receipt without the exact production project id", async () => {
  const publisher = createSharedSitePublisher({
    registry: fakeRegistry(),
    storage: memoryStorage(),
    env: NONLOCAL_ENV,
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: LOCAL_HOST_OK, // local-shaped receipt under non-local env
  });
  const staged = await publisher.stage(publisherInput());
  assert.equal(staged.ok, true, JSON.stringify(staged));
  await assert.rejects(() => staged.openPreview(), /shared_site_host_identity_mismatch/);
});

test("local publisher refuses a production-shaped receipt", async () => {
  const publisher = createSharedSitePublisher({
    registry: fakeRegistry(),
    storage: memoryStorage(),
    env: LOCAL_ENV,
    publicVerifier: PUBLIC_OK,
    ensureSharedSiteHost: PROD_HOST_OK, // production receipt under local env
  });
  const staged = await publisher.stage(publisherInput());
  assert.equal(staged.ok, true, JSON.stringify(staged));
  await assert.rejects(() => staged.openPreview(), /shared_site_host_identity_mismatch/);
});

// ---------------------------------------------------------------------------
// (d) integration: a real local router (apps/site-router) exchanges a real
// local grant over HTTP and refuses replays
// ---------------------------------------------------------------------------

describe("integration: real site-router preview-session exchange under local env", () => {
  // The local DB grant registry stand-in: the publisher's registry adapter
  // writes jti hashes here (register), the router's store consumes them
  // (consume). One row per grant; consumption deletes it, so a replay of the
  // same grant finds nothing. Exactly like the SQL contract, a registered
  // grant carries no slug — consume resolves it from the site identity row.
  function grantRegistry() {
    const rows = new Map();
    const sites = new Map([[SITE_ID, SLUG]]);
    return {
      async registerPreviewGrant(row) {
        rows.set(row.jtiHash, { ...row });
        return { ok: true };
      },
      consume(grant) {
        const jtiHash = createHash("sha256").update(grant.jti, "utf8").digest("hex");
        const row = rows.get(jtiHash);
        if (!row) return false;
        const tuple = [
          [row.siteId, grant.site_id],
          [row.releaseId, grant.release_id],
          [row.buildHash, grant.build_hash],
          [sites.get(grant.site_id), grant.slug],
          [row.environment, grant.env],
        ];
        if (tuple.some(([wanted, actual]) => wanted !== actual)) return false;
        rows.delete(jtiHash);
        return true;
      },
    };
  }

  // The compose gateway proxies to the router with `header_up Host
  // {labels.3}.wss-ai.com`; undici refuses host overrides, so the fixture
  // speaks raw node:http exactly like caddy does, against the REAL router
  // application (createRouterApplication, unmodified).
  function fixtureFetch({ port, calls }) {
    return function fixturePreviewFetch(url, options = {}) {
      const requested = String(url);
      const target = new URL(requested.replace(`${LOCAL_ORIGIN}`, `http://127.0.0.1:${port}`));
      const headers = Object.fromEntries(new Headers(options.headers || {}).entries());
      headers.host = HOST; // what caddy's header_up rewrite produces
      const payload = options.body === undefined ? null : Buffer.from(options.body);
      return new Promise((resolve, reject) => {
        const request = http.request({
          hostname: target.hostname,
          port: Number(target.port),
          path: `${target.pathname}${target.search}`,
          method: options.method || "GET",
          headers,
        }, (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const responseHeaders = new Headers();
            for (const [name, value] of Object.entries(res.headers)) {
              if (name === "set-cookie") {
                for (const single of [].concat(value)) responseHeaders.append("set-cookie", single);
              } else if (typeof value === "string") {
                responseHeaders.set(name, value);
              }
            }
            calls.push({
              url: requested,
              host: res.req.getHeaders().host,
              status: res.statusCode,
              body: payload ? payload.toString("utf8") : "",
              cookie: String(res.req.getHeaders().cookie || ""),
            });
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              url: requested,
              headers: responseHeaders,
              async arrayBuffer() { return Buffer.concat(chunks); },
            });
          });
        });
        request.on("error", reject);
        if (payload && payload.length) request.write(payload);
        request.end();
      });
    };
  }

  function startFixtureServer({ store }) {
    const app = createRouterApplication({
      store,
      env: { WSS_SITE_PREVIEW_SECRET: PREVIEW_SECRET, WSS_SHARED_SITE_ENV: "local" },
    });
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        Promise.resolve(app(req, res)).catch((error) => {
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.end("fixture error");
          }
          reject(error);
        });
      });
      server.listen(0, "127.0.0.1", () => {
        resolve({
          port: server.address().port,
          close: () => new Promise((done) => server.close(done)),
        });
      });
      server.on("error", reject);
    });
  }

  function routerStore(registry, seen) {
    return {
      async resolvePublicHost() { return null; },
      async resolvePreviewRelease() { return null; },
      async readManifest() { throw new Error("fixture_has_no_objects"); },
      async openAsset() { throw new Error("fixture_has_no_objects"); },
      async consumePreviewGrant(grant) {
        seen.push({ ...grant });
        return registry.consume(grant);
      },
    };
  }

  test("a local grant exchanges 204 over HTTP against the local router and a replay is refused", async () => {
    const registry = grantRegistry();
    const seen = [];
    const calls = [];
    const server = await startFixtureServer({ store: routerStore(registry, seen) });
    try {
      const send = fixtureFetch({ port: server.port, calls });
      // The LOCAL DB grant registry is one durable thing with two sides: the
      // publisher's registry adapter writes registered grants into it, and
      // the local router's store consumes them from it.
      const publisher = localPublisher({
        previewFetch: send,
        registry: { ...fakeRegistry(), registerPreviewGrant: registry.registerPreviewGrant },
      });
      const staged = await publisher.stage(publisherInput());
      assert.equal(staged.ok, true, JSON.stringify(staged));

      const session = await staged.openPreview();
      const exchange = calls.find((call) => call.url === `${LOCAL_ORIGIN}/api/preview-session`);
      assert.ok(exchange, "exchange reached the fixture");
      assert.equal(exchange.status, 204, "the real local router exchanged the local grant");
      assert.equal(exchange.host, HOST);
      assert.equal(session.origin, LOCAL_ORIGIN);
      assert.equal(seen.length, 1, "exactly one grant consumed from the local registry");

      // The issued session cookie is a real local preview session.
      await session.fetch("/?preview=1");
      const pageView = calls.find((call) => call.url === `${LOCAL_ORIGIN}/?preview=1`);
      assert.ok(pageView, "preview fetch reached the fixture");
      const cookie = pageView.cookie;
      assert.match(cookie, /^__Host-wss-site-preview=/);
      const token = cookie.split("=")[1].split(";")[0];
      const verifiedSession = verifyPreviewSession(token, {
        env: "local",
        secret: PREVIEW_SECRET,
      });
      assert.ok(verifiedSession);
      assert.equal(verifiedSession.site_id, SITE_ID);
      assert.equal(verifiedSession.slug, SLUG);
      assert.equal(verifiedSession.env, "local");

      // One-use law: replaying the exact grant the publisher just exchanged
      // is refused by the real router (the local registry row is gone).
      const consumedGrant = JSON.parse(exchange.body).grant;
      assert.match(consumedGrant, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const replay = await send(`${LOCAL_ORIGIN}/api/preview-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant: consumedGrant }),
      });
      assert.equal(replay.status, 401, "a consumed grant never exchanges twice");
    } finally {
      await server.close();
    }
  });
});

// ---------------------------------------------------------------------------
// (d) engine: the opened preview's LOCAL gateway origin names the same
// release as the canonical host under the local environment. Before this
// seam every local rebuild died shared_preview_identity_mismatch at
// normalizeOpenedPreview (publisher exchanged on the local gateway, engine
// demanded the canonical host). Outside local the canonical-host rule is
// exactly as strict as before.
// ---------------------------------------------------------------------------
test("engine normalizeOpenedPreview accepts the local gateway origin only under the local environment", async () => {
  const { mirror, normalizeOpenedPreview } = require("../lib/mirror-engine/engine");
  assert.equal(typeof normalizeOpenedPreview, "function");

  const caps = { fetch: async () => {}, preparePage: async () => {} };
  const openedLocal = { origin: LOCAL_ORIGIN, ...caps };
  const openedCanonical = { origin: `https://${HOST}/`, ...caps };
  const openedForeign = { origin: "https://evil.example.com/", ...caps };

  const prev = process.env.WSS_SHARED_SITE_ENV;
  try {
    process.env.WSS_SHARED_SITE_ENV = "local";
    const localOk = normalizeOpenedPreview(openedLocal, { host: HOST });
    assert.equal(localOk.ok, true);
    assert.equal(localOk.origin, LOCAL_ORIGIN, "the engine keeps the reachable local origin as the probe base");
    assert.equal(normalizeOpenedPreview(openedCanonical, { host: HOST }).ok, true, "canonical origin still accepted");
    assert.equal(normalizeOpenedPreview(openedForeign, { host: HOST }).reason, "shared_preview_identity_mismatch", "any other host still refused");

    process.env.WSS_SHARED_SITE_ENV = "production";
    assert.equal(
      normalizeOpenedPreview(openedLocal, { host: HOST }).reason,
      "shared_preview_identity_mismatch",
      "outside the local environment the gateway origin is refused exactly as before",
    );
    assert.equal(normalizeOpenedPreview(openedCanonical, { host: HOST }).ok, true);
  } finally {
    if (prev === undefined) delete process.env.WSS_SHARED_SITE_ENV;
    else process.env.WSS_SHARED_SITE_ENV = prev;
  }
  // mirror stays the exported build entry (regression: export surface intact)
  assert.equal(typeof mirror, "function");
});
