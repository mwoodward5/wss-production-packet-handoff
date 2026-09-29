"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PREVIEW_COOKIE, PREVIEW_GRANT_AUDIENCE } = require("../lib/constants");
const { createPreviewSessionHandler } = require("../lib/preview-handler");
const { encodeToken, verifyPreviewSession } = require("../lib/token");
const {
  BUILD_HASH,
  HOST,
  MockResponse,
  RELEASE_ID,
  SITE_ID,
  fixture,
  request
} = require("./helpers");

const NOW = 2_000_000_000;
const SECRET = "router-test-secret-that-is-at-least-32-bytes";
const ENV = { WSS_SITE_PREVIEW_SECRET: SECRET, WSS_SHARED_SITE_ENV: "test" };

function claims(overrides = {}) {
  return {
    v: 1,
    aud: PREVIEW_GRANT_AUDIENCE,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: "honest-fence",
    env: "test",
    jti: "grant_1",
    iat: NOW,
    exp: NOW + 300,
    ...overrides
  };
}

async function run(handler, req) {
  const res = new MockResponse();
  await handler(req, res);
  return res;
}

test("POST exchanges a short HMAC grant for a strict host-only session cookie", async () => {
  const f = fixture();
  let consumed;
  f.store.consumePreviewGrant = async (grant) => {
    f.calls.consumePreviewGrant += 1;
    consumed = grant;
    return true;
  };
  const handler = createPreviewSessionHandler({
    store: f.store,
    env: ENV,
    nowSeconds: () => NOW,
    randomId: () => "session_1"
  });
  const grant = encodeToken(claims(), SECRET);
  const res = await run(handler, request({
    body: { grant },
    headers: { "content-type": "application/json" },
    method: "POST",
    path: "/api/preview-session"
  }));

  assert.equal(res.statusCode, 204);
  assert.equal(res.text(), "");
  assert.equal(consumed.jti, "grant_1");
  assert.match(res.getHeader("cache-control"), /^private,.*no-store/);
  const cookie = res.getHeader("set-cookie");
  assert.match(cookie, new RegExp(`^${PREVIEW_COOKIE}=`));
  assert.match(cookie, /; Max-Age=300;/);
  assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
  assert.doesNotMatch(cookie, /Domain=/i);
  const token = cookie.slice(cookie.indexOf("=") + 1, cookie.indexOf(";"));
  const session = verifyPreviewSession(token, { env: "test", nowSeconds: NOW, secret: SECRET });
  assert.equal(session.site_id, SITE_ID);
  assert.equal(session.release_id, RELEASE_ID);
  assert.equal(session.build_hash, BUILD_HASH);
  assert.equal(session.exp - session.iat, 300);
  assert.ok(verifyPreviewSession(token, { env: "test", nowSeconds: NOW + 299, secret: SECRET }));
  assert.equal(verifyPreviewSession(token, { env: "test", nowSeconds: NOW + 300, secret: SECRET }), null);
});

test("grant in URL is rejected before parsing or consumption", async () => {
  const f = fixture();
  const handler = createPreviewSessionHandler({ store: f.store, env: ENV, nowSeconds: () => NOW });
  const res = await run(handler, request({
    body: { grant: encodeToken(claims(), SECRET) },
    method: "POST",
    path: "/api/preview-session?grant=secret"
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(f.calls.consumePreviewGrant, 0);
  assert.equal(res.getHeader("set-cookie"), undefined);
});

test("duplicate raw grant keys are rejected before consumption or cookie issue", async () => {
  const f = fixture();
  const handler = createPreviewSessionHandler({ store: f.store, env: ENV, nowSeconds: () => NOW });
  const grant = encodeToken(claims(), SECRET);
  for (const secondKey of ["grant", "gr\\u0061nt"]) {
    const body = `{"grant":${JSON.stringify(grant)},"${secondKey}":${JSON.stringify(grant)}}`;
    const res = await run(handler, request({
      body,
      headers: { "content-type": "application/json" },
      method: "POST",
      path: "/api/preview-session"
    }));
    assert.equal(res.statusCode, 400, secondKey);
    assert.equal(f.calls.consumePreviewGrant, 0, secondKey);
    assert.equal(res.getHeader("set-cookie"), undefined, secondKey);
  }
});

test("expired, overlong, wrong-environment, wrong-host, and consumed grants are refused", async () => {
  const cases = [
    { tokenClaims: claims({ exp: NOW - 1 }) },
    { tokenClaims: claims({ exp: NOW + 301 }) },
    { tokenClaims: claims({ env: "production" }) },
    { tokenClaims: claims({ slug: "other-site" }) }
  ];
  for (const item of cases) {
    const f = fixture();
    const handler = createPreviewSessionHandler({ store: f.store, env: ENV, nowSeconds: () => NOW });
    const res = await run(handler, request({
      body: { grant: encodeToken(item.tokenClaims, SECRET) },
      method: "POST",
      path: "/api/preview-session"
    }));
    assert.equal(res.statusCode, 401);
    assert.equal(res.getHeader("set-cookie"), undefined);
  }

  const replay = fixture();
  replay.store.consumePreviewGrant = async () => false;
  const replayHandler = createPreviewSessionHandler({ store: replay.store, env: ENV, nowSeconds: () => NOW });
  const replayRes = await run(replayHandler, request({
    body: { grant: encodeToken(claims(), SECRET) },
    method: "POST",
    path: "/api/preview-session"
  }));
  assert.equal(replayRes.statusCode, 401);
  assert.equal(replayRes.getHeader("set-cookie"), undefined);
});

test("tampered grant, direct host, and missing configuration fail closed", async () => {
  const f = fixture();
  const handler = createPreviewSessionHandler({ store: f.store, env: ENV, nowSeconds: () => NOW });
  const good = encodeToken(claims(), SECRET);
  const tampered = `${good.slice(0, -1)}${good.endsWith("a") ? "b" : "a"}`;
  const badSig = await run(handler, request({ body: { grant: tampered }, method: "POST", path: "/api/preview-session" }));
  assert.equal(badSig.statusCode, 401);

  const direct = await run(handler, request({
    body: { grant: good },
    host: "router.vercel.app",
    method: "POST",
    path: "/api/preview-session"
  }));
  assert.equal(direct.statusCode, 404);

  const noConfig = createPreviewSessionHandler({ store: f.store, env: {}, nowSeconds: () => NOW });
  const unavailable = await run(noConfig, request({ body: { grant: good }, method: "POST", path: "/api/preview-session" }));
  assert.equal(unavailable.statusCode, 503);
});

test("preview endpoint accepts POST only and never enables CORS", async () => {
  const f = fixture();
  const handler = createPreviewSessionHandler({ store: f.store, env: ENV, nowSeconds: () => NOW });
  const res = await run(handler, request({ method: "GET", path: "/api/preview-session" }));
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader("allow"), "POST");
  assert.equal(res.getHeader("access-control-allow-origin"), undefined);
});
