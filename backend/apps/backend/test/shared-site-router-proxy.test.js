"use strict";

const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

const route = require("../api/internal/shared-site-router");
const {
  MAX_BODY_BYTES,
  SIGNED_URL_TTL_SECONDS,
  handleProxyRequest,
  parseJsonWithoutDuplicates,
} = require("../lib/shared-site-router-proxy");

const NOW = 2_000_000_000;
const SITE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RELEASE_ID = "33333333-3333-4333-8333-333333333333";
const BUILD_HASH = "b".repeat(64);
const MANIFEST_SHA = "c".repeat(64);
const JTI_HASH = "d".repeat(64);
const SLUG = "acme-plumbing";
const HOST = `${SLUG}.wss-ai.com`;
const DEPLOYMENT_ENV = "production";
const SECRET = "router-proxy-secret-with-more-than-32-bytes";
const SERVICE_KEY = "service-role-secret-with-enough-bytes";
const SUPABASE_ORIGIN = "https://project.supabase.test";

const ENV = Object.freeze({
  WSS_SHARED_SITE_ROUTER_PROXY_SECRET: SECRET,
  WSS_SHARED_PUBLISH_ENABLED: "1",
  WSS_SHARED_SERVING_ENABLED: "1",
  WSS_SHARED_SITE_ALLOWLIST: `${SLUG},${SITE_ID}`,
  WSS_SHARED_SITE_ENV: DEPLOYMENT_ENV,
  SUPABASE_URL: SUPABASE_ORIGIN,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
});

function resolverRow(overrides = {}) {
  return {
    site_id: SITE_ID,
    canonical_slug: SLUG,
    canonical_host: HOST,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
    manifest_sha256: MANIFEST_SHA,
    deployment_env: DEPLOYMENT_ENV,
    generation: 1,
    ...overrides,
  };
}

function signedRaw(raw, timestamp = NOW, secret = SECRET) {
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  const signature = createHmac("sha256", secret)
    .update(String(timestamp), "utf8")
    .update(".", "utf8")
    .update(body)
    .digest("hex");
  return {
    rawBody: body,
    headers: {
      "x-wss-timestamp": String(timestamp),
      "x-wss-signature": signature,
    },
  };
}

function request(operation, input, options = {}) {
  const raw = options.raw || JSON.stringify({ operation, input });
  return handleProxyRequest({
    method: options.method || "POST",
    env: options.env || ENV,
    fetchImpl: options.fetchImpl,
    nowSeconds: options.nowSeconds ?? NOW,
    ...signedRaw(raw, options.timestamp ?? NOW, options.secret || SECRET),
    ...(options.headers ? { headers: options.headers } : {}),
  });
}

function response(value, ok = true) {
  return { ok, async json() { return value; } };
}

test("auth is raw-byte HMAC-bound and limited to the 60-second replay window", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response([]); };
  const input = { host: HOST, deployment_env: DEPLOYMENT_ENV };

  assert.equal((await request("resolve_public", input, { method: "GET", fetchImpl })).status, 405);
  assert.equal((await request("resolve_public", input, { timestamp: NOW - 61, fetchImpl })).body.error, "signature_expired");
  assert.equal((await request("resolve_public", input, { timestamp: NOW + 61, fetchImpl })).body.error, "signature_expired");

  const good = signedRaw(JSON.stringify({ operation: "resolve_public", input }));
  good.headers["x-wss-signature"] = "0".repeat(64);
  const bad = await handleProxyRequest({ method: "POST", env: ENV, fetchImpl, nowSeconds: NOW, ...good });
  assert.equal(bad.status, 401);

  const duplicateHeaders = await handleProxyRequest({
    method: "POST",
    env: ENV,
    fetchImpl,
    nowSeconds: NOW,
    ...signedRaw(JSON.stringify({ operation: "resolve_public", input })),
    headers: {
      ...signedRaw(JSON.stringify({ operation: "resolve_public", input })).headers,
      "X-WSS-Timestamp": String(NOW),
    },
  });
  assert.equal(duplicateHeaders.status, 401);

  const oversized = Buffer.alloc(MAX_BODY_BYTES + 1, 0x20);
  const tooLarge = await handleProxyRequest({
    method: "POST",
    env: ENV,
    fetchImpl,
    nowSeconds: NOW,
    ...signedRaw(oversized),
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(calls, 0, "auth and size refusals make zero provider calls");
});

test("the endpoint is dormant without an explicit serving flag, strong shared secret, and allowlist", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response([]); };
  const input = { host: HOST, deployment_env: DEPLOYMENT_ENV };
  const cases = [
    { ...ENV, WSS_SHARED_SERVING_ENABLED: "" },
    { ...ENV, WSS_SHARED_SERVING_ENABLED: "0" },
    { ...ENV, WSS_SHARED_SERVING_ENABLED: "false" },
    { ...ENV, WSS_SHARED_SITE_ROUTER_PROXY_SECRET: "short" },
    { ...ENV, WSS_SHARED_SITE_ALLOWLIST: "" },
    { ...ENV, WSS_SHARED_SITE_ALLOWLIST: "someone-else" },
    { ...ENV, WSS_SHARED_SITE_ENV: "" },
    { ...ENV, WSS_SHARED_SITE_ENV: " production" },
    { ...ENV, WSS_SITE_ROUTER_ENV: "preview" },
  ];
  for (const env of cases) {
    const result = await request("resolve_public", input, { env, fetchImpl, secret: env.WSS_SHARED_SITE_ROUTER_PROXY_SECRET });
    assert.notEqual(result.status, 200);
  }
  assert.equal(calls, 0);
});

test("publish disabled plus serving enabled still resolves, signs, and consumes active release grants", async () => {
  const objectPath = `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`;
  const env = {
    ...ENV,
    WSS_SHARED_PUBLISH_ENABLED: "0",
    WSS_SHARED_SERVING_ENABLED: "1",
  };
  let resolveCalls = 0;
  const resolved = await request("resolve_public", { host: HOST, deployment_env: DEPLOYMENT_ENV }, {
    env,
    fetchImpl: async () => { resolveCalls += 1; return response([resolverRow()]); },
  });
  assert.equal(resolved.status, 200, JSON.stringify(resolved));
  assert.equal(resolveCalls, 1);

  const signCalls = [];
  const signed = await request("sign_object", {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    deployment_env: DEPLOYMENT_ENV,
    mode: "public",
    host: HOST,
    object_path: objectPath,
  }, {
    env,
    fetchImpl: async (url) => {
      signCalls.push(url);
      if (signCalls.length === 1) return response([resolverRow()]);
      return response({
        signedURL: `/object/sign/wss-site-releases/${objectPath}?token=serving-only-token`,
      });
    },
  });
  assert.equal(signed.status, 200, JSON.stringify(signed));
  assert.equal(signCalls.length, 2);

  let consumeCalls = 0;
  const consumed = await request("consume_preview", {
    jti_hash: JTI_HASH,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: SLUG,
    deployment_env: DEPLOYMENT_ENV,
  }, {
    env,
    fetchImpl: async () => {
      consumeCalls += 1;
      return response({
        ok: true,
        site_id: SITE_ID,
        release_id: RELEASE_ID,
        build_hash: BUILD_HASH,
        deployment_env: DEPLOYMENT_ENV,
        manifest_path: objectPath,
        slug: SLUG,
      });
    },
  });
  assert.equal(consumed.status, 200, JSON.stringify(consumed));
  assert.equal(consumeCalls, 1);
});

test("duplicate JSON keys, extras, arrays, invalid UTF-8, and unknown operations are refused before providers", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response([]); };
  const invalid = [
    `{"operation":"resolve_public","operation":"consume_preview","input":{"host":"${HOST}","deployment_env":"${DEPLOYMENT_ENV}"}}`,
    `{"operation":"resolve_public","input":{"host":"${HOST}","host":"evil.wss-ai.com","deployment_env":"${DEPLOYMENT_ENV}"}}`,
    JSON.stringify({ operation: "resolve_public", input: { host: HOST, deployment_env: DEPLOYMENT_ENV }, extra: true }),
    JSON.stringify({ operation: "resolve_public", input: { host: HOST, deployment_env: DEPLOYMENT_ENV, extra: true } }),
    JSON.stringify({ operation: "resolve_public", input: [] }),
    JSON.stringify({ operation: "arbitrary_rpc", input: {} }),
  ];
  for (const raw of invalid) {
    const result = await request("ignored", {}, { raw, fetchImpl });
    assert.equal(result.status, 400, raw);
  }
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  const invalidEncoding = await handleProxyRequest({
    method: "POST", env: ENV, fetchImpl, nowSeconds: NOW, ...signedRaw(invalidUtf8),
  });
  assert.equal(invalidEncoding.status, 400);
  assert.equal(calls, 0);
  assert.throws(
    () => parseJsonWithoutDuplicates(Buffer.from('{"outer":{"x":1,"x":2}}')),
    /duplicate_json_key/,
  );
});

test("resolve_public calls only the exact resolver RPC and projects the frozen row shape", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response([resolverRow()]);
  };
  const result = await request("resolve_public", { host: HOST, deployment_env: DEPLOYMENT_ENV }, {
    env: {
      ...ENV,
      WSS_SHARED_SITE_ALLOWLIST: SLUG,
      WSS_SITE_ROUTER_ENV: DEPLOYMENT_ENV,
    },
    fetchImpl,
  });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.body, {
    ok: true,
    operation: "resolve_public",
    data: {
      site_id: SITE_ID,
      release_id: RELEASE_ID,
      build_hash: BUILD_HASH,
      canonical_host: HOST,
      generation: 1,
      manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
      manifest_sha256: MANIFEST_SHA,
      deployment_env: DEPLOYMENT_ENV,
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${SUPABASE_ORIGIN}/rest/v1/rpc/resolve_shared_site`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_slug: null,
    p_host: HOST,
    p_deployment_env: DEPLOYMENT_ENV,
  });
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.apikey, SERVICE_KEY);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${SERVICE_KEY}`);
});

test("resolve_preview enforces the exact tuple, slug, environment, and generation-zero semantics", async () => {
  const calls = [];
  const input = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: SLUG,
    deployment_env: DEPLOYMENT_ENV,
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response([resolverRow({ generation: "0" })]);
  };
  const result = await request("resolve_preview", input, { fetchImpl });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.body.data.generation, 0);
  assert.equal(calls[0].url, `${SUPABASE_ORIGIN}/rest/v1/rpc/resolve_shared_site_preview`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_site_id: SITE_ID,
    p_release_id: RELEASE_ID,
    p_build_hash: BUILD_HASH,
    p_slug: SLUG,
    p_deployment_env: DEPLOYMENT_ENV,
  });

  const mismatchFetch = async () => response([resolverRow({ release_id: OTHER_RELEASE_ID })]);
  const mismatch = await request("resolve_preview", input, { fetchImpl: mismatchFetch });
  assert.equal(mismatch.status, 503);
  assert.equal(mismatch.body.error, "provider_identity_mismatch");
});

test("consume_preview performs only the atomic exact-tuple RPC and returns no provider extras", async () => {
  const calls = [];
  const input = {
    jti_hash: JTI_HASH,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: SLUG,
    deployment_env: DEPLOYMENT_ENV,
  };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return response({
      ok: true,
      site_id: SITE_ID,
      release_id: RELEASE_ID,
      build_hash: BUILD_HASH,
      deployment_env: DEPLOYMENT_ENV,
      manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
      slug: SLUG,
    });
  };
  const result = await request("consume_preview", input, { fetchImpl });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.body.data, {
    ok: true,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: SLUG,
    deployment_env: DEPLOYMENT_ENV,
  });
  assert.equal(calls[0].url, `${SUPABASE_ORIGIN}/rest/v1/rpc/consume_site_preview_grant`);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    p_jti_hash: JTI_HASH,
    p_site_id: SITE_ID,
    p_release_id: RELEASE_ID,
    p_build_hash: BUILD_HASH,
    p_deployment_env: DEPLOYMENT_ENV,
  });

  const siteIdOnly = await request("consume_preview", input, {
    env: { ...ENV, WSS_SHARED_SITE_ALLOWLIST: SITE_ID },
    fetchImpl,
  });
  assert.equal(siteIdOnly.status, 200, JSON.stringify(siteIdOnly));

  const wrongSlug = await request("consume_preview", input, {
    fetchImpl: async () => response({
      ok: true,
      site_id: SITE_ID,
      release_id: RELEASE_ID,
      build_hash: BUILD_HASH,
      deployment_env: DEPLOYMENT_ENV,
      manifest_path: `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`,
      slug: "other-plumbing",
    }),
  });
  assert.equal(wrongSlug.status, 503);
  assert.equal(wrongSlug.body.error, "provider_identity_mismatch");
});

test("resolve_public refuses a UUID-only allowlist before arbitrary wildcard traffic reaches the provider", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response([resolverRow()]); };
  const result = await request("resolve_public", { host: HOST, deployment_env: DEPLOYMENT_ENV }, {
    env: { ...ENV, WSS_SHARED_SITE_ALLOWLIST: SITE_ID },
    fetchImpl,
  });
  assert.equal(result.status, 403, JSON.stringify(result));
  assert.equal(result.body.error, "site_not_allowed");
  assert.equal(calls, 0);
});

test("sign_object re-resolves a public release, then signs only its immutable private object for 120 seconds", async () => {
  const objectPath = `sites/${SITE_ID}/releases/${RELEASE_ID}/files/assets/app.js`;
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return response([resolverRow()]);
    return response({
      signedURL: `/object/sign/wss-site-releases/${objectPath}?token=short-lived-token`,
    });
  };
  const result = await request("sign_object", {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    deployment_env: DEPLOYMENT_ENV,
    mode: "public",
    host: HOST,
    object_path: objectPath,
  }, { fetchImpl });
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.deepEqual(result.body.data, {
    signed_url: `${SUPABASE_ORIGIN}/storage/v1/object/sign/wss-site-releases/${objectPath}?token=short-lived-token`,
    expires_at: NOW + SIGNED_URL_TTL_SECONDS,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${SUPABASE_ORIGIN}/rest/v1/rpc/resolve_shared_site`);
  assert.equal(calls[1].url, `${SUPABASE_ORIGIN}/storage/v1/object/sign/wss-site-releases/${objectPath}`);
  assert.deepEqual(JSON.parse(calls[1].options.body), { expiresIn: 120 });
});

test("sign_object accepts only exact Supabase signed URL shapes and keeps hostile responses closed", async () => {
  const objectPath = `sites/${SITE_ID}/releases/${RELEASE_ID}/files/assets/app.js`;
  const input = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    deployment_env: DEPLOYMENT_ENV,
    mode: "public",
    host: HOST,
    object_path: objectPath,
  };
  async function signWith(signedURL) {
    let calls = 0;
    const result = await request("sign_object", input, {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? response([resolverRow()]) : response({ signedURL });
      },
    });
    assert.equal(calls, 2);
    return result;
  }

  const official = `/object/sign/wss-site-releases/${objectPath}?token=official`;
  const expanded = `/storage/v1/object/sign/wss-site-releases/${objectPath}?token=expanded`;
  const accepted = [
    official,
    expanded,
    `${SUPABASE_ORIGIN}${official}`,
    `${SUPABASE_ORIGIN}${expanded}`,
  ];
  for (const signedURL of accepted) {
    const result = await signWith(signedURL);
    assert.equal(result.status, 200, signedURL);
    assert.match(result.body.data.signed_url, new RegExp(`^${SUPABASE_ORIGIN}/storage/v1/object/sign/`));
  }

  const hostile = [
    `https://evil.example/object/sign/wss-site-releases/${objectPath}?token=x`,
    `//evil.example/object/sign/wss-site-releases/${objectPath}?token=x`,
    `//project.supabase.test/object/sign/wss-site-releases/${objectPath}?token=x`,
    `object/sign/wss-site-releases/${objectPath}?token=x`,
    `http://project.supabase.test/object/sign/wss-site-releases/${objectPath}?token=x`,
    `https://user@project.supabase.test/object/sign/wss-site-releases/${objectPath}?token=x`,
    `/object/sign/wss-site-releases/${objectPath}?token=x#fragment`,
    `/object/sign/other-bucket/${objectPath}?token=x`,
    `/object/sign/wss-site-releases/${objectPath.replace("app.js", "other.js")}?token=x`,
    `/object/sign/wss-site-releases/${objectPath.replace("files/assets/app.js", "files/assets/../app.js")}?token=x`,
    `/object/sign/wss-site-releases/${objectPath.replace("files/assets/app.js", "files/assets/%2e%2e/app.js")}?token=x`,
    `/object/sign/wss-site-releases/${objectPath}`,
    `/object/sign/wss-site-releases/${objectPath}?token=`,
    `/object/sign/wss-site-releases/${objectPath}?token=x&download=1`,
    `/object/sign/wss-site-releases/${objectPath}?token=x&token=y`,
  ];
  for (const signedURL of hostile) {
    const refused = await signWith(signedURL);
    assert.equal(refused.status, 503, signedURL);
    assert.equal(refused.body.error, "provider_identity_mismatch", signedURL);
  }
});

test("preview signing uses the preview resolver and path/mode/tuple mismatches never reach Storage", async () => {
  const manifestPath = `sites/${SITE_ID}/releases/${RELEASE_ID}/manifest.json`;
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) return response([resolverRow({ generation: 0 })]);
    return response({
      signedURL: `/object/sign/wss-site-releases/${manifestPath}?token=preview-token`,
    });
  };
  const base = {
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    deployment_env: DEPLOYMENT_ENV,
    mode: "preview",
    slug: SLUG,
    object_path: manifestPath,
  };
  const good = await request("sign_object", base, { fetchImpl });
  assert.equal(good.status, 200, JSON.stringify(good));
  assert.match(calls[0], /resolve_shared_site_preview$/);
  assert.match(calls[1], /storage\/v1\/object\/sign\/wss-site-releases/);

  let refusedCalls = 0;
  const never = async () => { refusedCalls += 1; return response([]); };
  const badPaths = [
    `sites/${SITE_ID}/releases/${OTHER_RELEASE_ID}/manifest.json`,
    `sites/${SITE_ID}/releases/${RELEASE_ID}/files/../secret`,
    `sites/${SITE_ID}/releases/${RELEASE_ID}/files/%2e%2e/secret`,
    `sites/${SITE_ID}/releases/${RELEASE_ID}/files//app.js`,
  ];
  for (const object_path of badPaths) {
    const refused = await request("sign_object", { ...base, object_path }, { fetchImpl: never });
    assert.notEqual(refused.status, 200, object_path);
  }
  const wrongIdentityKey = await request("sign_object", { ...base, host: HOST }, { fetchImpl: never });
  assert.equal(wrongIdentityKey.status, 400);
  assert.equal(refusedCalls, 0, "locally invalid sign requests make no resolver or Storage calls");

  let mismatchCalls = 0;
  const mismatch = await request("sign_object", base, {
    fetchImpl: async () => { mismatchCalls += 1; return response([resolverRow({ build_hash: "e".repeat(64) })]); },
  });
  assert.equal(mismatch.status, 503);
  assert.equal(mismatchCalls, 1, "resolver mismatch makes no Storage call");
});

test("missing service credentials and provider failures fail closed without exposing secrets", async () => {
  let calls = 0;
  const input = { host: HOST, deployment_env: DEPLOYMENT_ENV };
  const noService = await request("resolve_public", input, {
    env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" },
    fetchImpl: async () => { calls += 1; return response([]); },
  });
  assert.equal(noService.status, 503);
  assert.equal(calls, 0);

  const providerFailure = await request("resolve_public", input, {
    fetchImpl: async () => { throw new Error(`${SECRET}:${SERVICE_KEY}`); },
  });
  const serialized = JSON.stringify(providerFailure);
  assert.equal(providerFailure.status, 503);
  assert.doesNotMatch(serialized, new RegExp(SECRET));
  assert.doesNotMatch(serialized, new RegExp(SERVICE_KEY));
  assert.doesNotMatch(serialized, /host|query|stack/i);
});

test("new Supabase secret keys are never placed in the Bearer header", async () => {
  const key = `sb_secret_${"x".repeat(32)}`;
  let headers;
  const fetchImpl = async (_url, options) => { headers = options.headers; return response([]); };
  const result = await request("resolve_public", { host: HOST, deployment_env: DEPLOYMENT_ENV }, {
    env: { ...ENV, SUPABASE_SERVICE_ROLE_KEY: key },
    fetchImpl,
  });
  assert.equal(result.status, 200);
  assert.equal(headers.apikey, key);
  assert.equal(headers.Authorization, undefined);
});

test("the API route keeps raw-body mode, no-store responses, and no CORS surface", () => {
  assert.deepEqual(route.config, { api: { bodyParser: false } });
  const headers = Object.create(null);
  let output = "";
  const res = {
    setHeader(name, value) { headers[name] = value; },
    end(value) { output = value; },
  };
  route._test.sendJson(res, 405, { ok: false, error: "method_not_allowed" });
  assert.equal(res.statusCode, 405);
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers.Allow, "POST");
  assert.equal(Object.keys(headers).some((name) => /^access-control/i.test(name)), false);
  assert.equal(JSON.parse(output).error, "method_not_allowed");
});
