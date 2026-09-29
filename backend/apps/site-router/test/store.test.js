"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");
const { validReleaseRef } = require("../lib/manifest");
const {
  createProductionStore,
  exactObjectAccess,
  releaseFromProxy,
  signedObjectUrl,
} = require("../lib/store");
const { BUILD_HASH, HOST, RELEASE_ID, SITE_ID } = require("./helpers");
const { handleProxyRequest } = require("../../backend/lib/shared-site-router-proxy");

const NOW = 2_000_000_000;
const PROXY_URL = "https://ghost.wss-ai.com/api/internal/shared-site-router";
const PROXY_SECRET = "proxy-test-secret-that-is-at-least-32-bytes";

function configuredEnv(overrides = {}) {
  return {
    WSS_SHARED_SITE_ENV: "preview",
    WSS_SHARED_SITE_PROXY_URL: PROXY_URL,
    WSS_SHARED_SITE_ROUTER_PROXY_SECRET: PROXY_SECRET,
    ...overrides
  };
}

function proxyRow(overrides = {}) {
  return {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    canonical_host: HOST,
    generation: 0,
    manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
    manifest_sha256: "d".repeat(64),
    deployment_env: "preview",
    ...overrides
  };
}

function success(operation, data) {
  return new Response(JSON.stringify({ ok: true, operation, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("proxy resolver keeps current generation separate and preserves signed-read context", () => {
  const publicRelease = releaseFromProxy(proxyRow({ generation: 3 }), "preview", {
    mode: "public",
    host: HOST
  });
  assert.equal(publicRelease.routeGeneration, 3);
  assert.equal(publicRelease.manifestKey, proxyRow().manifest_path);
  assert.equal(publicRelease.accessMode, "public");
  assert.equal(publicRelease.resolverHost, HOST);
  assert.equal(releaseFromProxy(proxyRow(), "preview").routeGeneration, 0);
  assert.equal(releaseFromProxy(proxyRow({ deployment_env: "production" }), "preview"), null);

  const validated = validReleaseRef(publicRelease, HOST);
  assert.equal(validated.accessMode, "public");
  assert.equal(validated.resolverHost, HOST);
});

test("production adapter signs every proxy POST and fetches only short-lived exact object URLs", async () => {
  const proxyCalls = [];
  const objectCalls = [];
  const manifest = Buffer.from("manifest");
  const asset = Buffer.from("asset bytes");

  const fetchImpl = async (url, options = {}) => {
    if (url === PROXY_URL) {
      const body = JSON.parse(options.body);
      proxyCalls.push({ body, rawBody: options.body, options });
      const expected = crypto.createHmac("sha256", PROXY_SECRET)
        .update(`${NOW}.${options.body}`, "utf8")
        .digest("hex");
      assert.equal(options.headers["x-wss-timestamp"], String(NOW));
      assert.equal(options.headers["x-wss-signature"], expected);
      assert.equal(options.headers.authorization, undefined);
      assert.equal(options.headers.apikey, undefined);
      assert.equal(options.redirect, "error");

      if (body.operation === "resolve_public") return success(body.operation, proxyRow({ generation: 9 }));
      if (body.operation === "resolve_preview") return success(body.operation, proxyRow({ generation: 0 }));
      if (body.operation === "consume_preview") {
        return success(body.operation, {
          ok: true,
          site_id: body.input.site_id,
          release_id: body.input.release_id,
          build_hash: body.input.build_hash,
          slug: body.input.slug,
          deployment_env: body.input.deployment_env
        });
      }
      if (body.operation === "sign_object") {
        const kind = body.input.object_path.endsWith("manifest.json") ? "manifest" : "asset";
        return success(body.operation, {
          signed_url: `https://objects.example/${kind}?token=short-lived`,
          expires_at: NOW + 60
        });
      }
      throw new Error(`unexpected operation ${body.operation}`);
    }

    objectCalls.push({ url, options });
    const body = url.includes("/manifest?") ? manifest : asset;
    return new Response(body, {
      status: 200,
      headers: {
        "content-length": String(body.length),
        "content-type": url.includes("/manifest?") ? "application/json" : "text/plain; charset=utf-8"
      }
    });
  };

  const store = createProductionStore({ env: configuredEnv(), fetchImpl, nowSeconds: () => NOW });
  const releaseCandidate = await store.resolvePublicHost(HOST, {});
  assert.equal(releaseCandidate.routeGeneration, 9);
  const release = validReleaseRef(releaseCandidate, HOST);
  assert.ok(release, "the real handler's release validation must retain proxy read context");
  assert.deepEqual(proxyCalls[0].body, {
    operation: "resolve_public",
    input: { host: HOST, deployment_env: "preview" }
  });

  const previewCandidate = await store.resolvePreviewRelease({
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: "honest-fence"
  }, {});
  assert.equal(previewCandidate.routeGeneration, 0);
  const preview = validReleaseRef(previewCandidate, HOST, { allowZeroGeneration: true });
  assert.ok(preview);
  assert.deepEqual(proxyCalls[1].body.input, {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: "honest-fence",
    deployment_env: "preview"
  });

  const manifestResult = await store.readManifest(release, {});
  assert.deepEqual(manifestResult.body, manifest);
  const publicSign = proxyCalls.find((call) => call.body.operation === "sign_object").body.input;
  assert.equal(publicSign.mode, "public");
  assert.equal(publicSign.host, HOST);
  assert.equal(Object.hasOwn(publicSign, "slug"), false);
  assert.equal(publicSign.object_path, release.manifestKey);

  const file = {
    key: `sites/${SITE_ID}/releases/${RELEASE_ID}/files/index.html`,
    bytes: asset.length,
    mime: "text/plain; charset=utf-8",
    sha256: crypto.createHash("sha256").update(asset).digest("hex")
  };
  const opened = await store.openAsset(release, file, {});
  assert.equal(opened.size, asset.length);
  assert.equal(opened.contentType, file.mime);
  assert.ok(objectCalls.every((call) => call.options.headers.range === undefined));
  assert.ok(objectCalls.every((call) => call.options.headers["accept-encoding"] === "identity"));
  assert.ok(objectCalls.every((call) => call.options.redirect === "error"));

  await store.readManifest(preview, {});
  const previewSign = proxyCalls.filter((call) => call.body.operation === "sign_object").at(-1).body.input;
  assert.equal(previewSign.mode, "preview");
  assert.equal(previewSign.slug, "honest-fence");
  assert.equal(Object.hasOwn(previewSign, "host"), false);

  const grant = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: "honest-fence",
    jti: "grant_1"
  };
  assert.equal(await store.consumePreviewGrant(grant, {}), true);
  const consume = proxyCalls.at(-1).body;
  assert.equal(consume.operation, "consume_preview");
  assert.equal(consume.input.jti_hash, crypto.createHash("sha256").update("grant_1").digest("hex"));
  assert.equal(consume.input.slug, "honest-fence");
  assert.equal(consume.input.deployment_env, "preview");
});

test("the real backend proxy and production router adapter agree on the complete wire contract", async () => {
  const supabaseOrigin = "https://project.supabase.test";
  const realSiteId = "11111111-1111-4111-8111-111111111111";
  const realReleaseId = "22222222-2222-4222-8222-222222222222";
  const manifest = Buffer.from("real proxy manifest bytes");
  const manifestPath = `sites/${realSiteId}/releases/${realReleaseId}/manifest.json`;
  const row = {
    ...proxyRow({
      site_id: realSiteId,
      release_id: realReleaseId,
      generation: 1,
      manifest_path: manifestPath,
      manifest_sha256: crypto.createHash("sha256").update(manifest).digest("hex")
    }),
    canonical_slug: "honest-fence"
  };
  const backendEnv = {
    WSS_SHARED_SITE_ROUTER_PROXY_SECRET: PROXY_SECRET,
    WSS_SHARED_PUBLISH_ENABLED: "0",
    WSS_SHARED_SERVING_ENABLED: "1",
    WSS_SHARED_SITE_ALLOWLIST: `honest-fence,${realSiteId}`,
    WSS_SHARED_SITE_ENV: "preview",
    SUPABASE_URL: supabaseOrigin,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-at-least-16-bytes"
  };
  const providerCalls = [];
  const providerFetch = async (url, options) => {
    providerCalls.push({ url, options });
    if (url.endsWith("/rest/v1/rpc/resolve_shared_site")) {
      return { ok: true, async json() { return [row]; } };
    }
    if (url.endsWith(`/storage/v1/object/sign/wss-site-releases/${manifestPath}`)) {
      return {
        ok: true,
        async json() {
          return { signedURL: `/object/sign/wss-site-releases/${manifestPath}?token=short-lived` };
        }
      };
    }
    throw new Error(`unexpected provider call ${url}`);
  };
  const fetchImpl = async (url, options = {}) => {
    if (url === PROXY_URL) {
      const result = await handleProxyRequest({
        method: "POST",
        headers: options.headers,
        rawBody: Buffer.from(options.body, "utf8"),
        env: backendEnv,
        fetchImpl: providerFetch,
        nowSeconds: NOW
      });
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" }
      });
    }
    if (url === `${supabaseOrigin}/storage/v1/object/sign/wss-site-releases/${manifestPath}?token=short-lived`) {
      return new Response(manifest, {
        status: 200,
        headers: { "content-length": String(manifest.length), "content-type": "application/json" }
      });
    }
    throw new Error(`unexpected router fetch ${url}`);
  };

  const store = createProductionStore({ env: configuredEnv(), fetchImpl, nowSeconds: () => NOW });
  const candidate = await store.resolvePublicHost(HOST, {});
  const release = validReleaseRef(candidate, HOST);
  assert.ok(release);
  assert.deepEqual((await store.readManifest(release, {})).body, manifest);
  assert.equal(providerCalls.length, 3, "resolve, re-resolve, then exact object signing only");
  assert.match(providerCalls[0].url, /resolve_shared_site$/);
  assert.match(providerCalls[1].url, /resolve_shared_site$/);
  assert.match(providerCalls[2].url, /storage\/v1\/object\/sign\/wss-site-releases/);
});

test("a slug-only canary consumes an exact preview grant through the real router and backend adapters", async () => {
  const siteId = "11111111-1111-4111-8111-111111111111";
  const releaseId = "22222222-2222-4222-8222-222222222222";
  const slug = "honest-fence";
  const manifestPath = `sites/${siteId}/releases/${releaseId}/manifest.json`;
  const backendEnv = {
    WSS_SHARED_SITE_ROUTER_PROXY_SECRET: PROXY_SECRET,
    WSS_SHARED_SERVING_ENABLED: "1",
    WSS_SHARED_SITE_ALLOWLIST: slug,
    WSS_SHARED_SITE_ENV: "preview",
    SUPABASE_URL: "https://project.supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-at-least-16-bytes"
  };
  const providerCalls = [];
  const providerFetch = async (url, options) => {
    providerCalls.push({ url, options });
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          site_id: siteId,
          release_id: releaseId,
          build_hash: BUILD_HASH,
          deployment_env: "preview",
          manifest_path: manifestPath,
          slug
        };
      }
    };
  };
  const fetchImpl = async (url, options = {}) => {
    assert.equal(url, PROXY_URL);
    const result = await handleProxyRequest({
      method: "POST",
      headers: options.headers,
      rawBody: Buffer.from(options.body, "utf8"),
      env: backendEnv,
      fetchImpl: providerFetch,
      nowSeconds: NOW
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" }
    });
  };

  const store = createProductionStore({ env: configuredEnv(), fetchImpl, nowSeconds: () => NOW });
  const consumed = await store.consumePreviewGrant({
    site_id: siteId,
    release_id: releaseId,
    build_hash: BUILD_HASH,
    slug,
    jti: "44444444-4444-4444-8444-444444444444"
  }, {});
  assert.equal(consumed, true);
  assert.equal(providerCalls.length, 1);
  assert.match(providerCalls[0].url, /consume_site_preview_grant$/);
  assert.equal(JSON.parse(providerCalls[0].options.body).p_site_id, siteId);
});

test("object signing refuses wrong prefixes, missing resolver context, and unsafe or long URLs", () => {
  const publicRelease = releaseFromProxy(proxyRow({ generation: 1 }), "preview", {
    mode: "public",
    host: HOST
  });
  const file = `sites/${SITE_ID}/releases/${RELEASE_ID}/files/index.html`;
  assert.equal(exactObjectAccess(publicRelease, file, "preview").host, HOST);
  assert.equal(exactObjectAccess(publicRelease, `sites/${SITE_ID}/releases/other/files/index.html`, "preview"), null);
  assert.equal(exactObjectAccess(publicRelease, `sites/${SITE_ID}/releases/${RELEASE_ID}/files/../manifest.json`, "preview"), null);
  assert.equal(exactObjectAccess({ ...publicRelease, resolverHost: "other.wss-ai.com" }, file, "preview"), null);

  assert.equal(signedObjectUrl({ signed_url: "http://objects.example/x", expires_at: NOW + 10 }, NOW), null);
  assert.equal(signedObjectUrl({ signed_url: "https://user@objects.example/x", expires_at: NOW + 10 }, NOW), null);
  assert.equal(signedObjectUrl({ signed_url: "https://objects.example/x#secret", expires_at: NOW + 10 }, NOW), null);
  assert.equal(signedObjectUrl({ signed_url: "https://objects.example/x", expires_at: NOW + 121 }, NOW), null);
  assert.equal(signedObjectUrl({ signed_url: "https://objects.example/x", expires_at: NOW }, NOW), null);
  assert.equal(
    signedObjectUrl({ signed_url: "https://objects.example/x?token=ok", expires_at: NOW + 120 }, NOW),
    "https://objects.example/x?token=ok"
  );
});

test("missing proxy config fails closed; partial, mismatched, weak, and provider credentials fail startup", async () => {
  const absent = createProductionStore({ env: {}, fetchImpl: async () => { throw new Error("not called"); } });
  assert.equal(absent.isReady(), false);
  await assert.rejects(() => absent.resolvePublicHost(HOST, {}), /store_not_configured/);

  const configured = createProductionStore({
    env: configuredEnv(),
    fetchImpl: async () => { throw new Error("health readiness must not call the proxy"); }
  });
  assert.equal(configured.isReady(), true);

  assert.throws(() => createProductionStore({
    env: { WSS_SHARED_SITE_ENV: "preview", WSS_SHARED_SITE_PROXY_URL: PROXY_URL },
    fetchImpl: async () => {}
  }), /proxy_configuration_incomplete/);
  assert.throws(() => createProductionStore({
    env: configuredEnv({ WSS_SITE_ROUTER_ENV: "production" }),
    fetchImpl: async () => {}
  }), /shared_site_environment_mismatch/);
  assert.throws(() => createProductionStore({
    env: configuredEnv({ WSS_SHARED_SITE_ROUTER_PROXY_SECRET: "too-short" }),
    fetchImpl: async () => {}
  }), /proxy_secret_weak/);
  assert.throws(() => createProductionStore({
    env: configuredEnv({ WSS_SHARED_SITE_PROXY_URL: "http://ghost.wss-ai.com/proxy" }),
    fetchImpl: async () => {}
  }), /proxy_url_invalid/);
  assert.throws(() => createProductionStore({
    env: configuredEnv({ WSS_SITE_ROUTER_RPC_TOKEN: "any-database-token" }),
    fetchImpl: async () => {}
  }), /direct_provider_credentials_refused/);
  for (const name of [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_DB_URL",
    "SUPABASE_SERVICE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "VITE_SUPABASE_URL",
    "CALLPREP_SUPABASE_SERVICE_ROLE_KEY",
    "MISSION_CONTROL_SUPABASE_PUBLISHABLE_KEY"
  ]) {
    assert.throws(() => createProductionStore({
      env: configuredEnv({ [name]: "must-not-enter-router" }),
      fetchImpl: async () => {}
    }), /direct_provider_credentials_refused/, name);
  }
  assert.doesNotThrow(() => createProductionStore({
    env: configuredEnv({ SUPABASE_REGION: "us-west-2" }),
    fetchImpl: async () => {}
  }));
});
