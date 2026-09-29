"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRouterApplication } = require("../lib/application");
const { MockResponse, fixture, request } = require("./helpers");

async function run(app, req) {
  const res = new MockResponse();
  await app(req, res);
  return res;
}

test("catch-all application ignores client route aliases and duplicate query values", async () => {
  for (const path of [
    "/?__wss_path=/secret",
    "/?__wss_path=/secret&__wss_path=/api/site",
    "/?route=/api/site"
  ]) {
    const f = fixture();
    const app = createRouterApplication({ store: f.store });
    const res = await run(app, request({
      path,
      rewrittenPath: "/api/site"
    }));
    assert.equal(res.statusCode, 200, path);
    assert.match(res.text(), /Honest Fence/);
    assert.equal(f.calls.resolvePublicHost, 1);
  }
});

test("direct internal endpoints and encoded or duplicate traversal fail before storage", async () => {
  for (const path of [
    "/api",
    "/api/site",
    "/api/index",
    "/api/index.js",
    "/api/site?__wss_path=/",
    "/api%2fsite",
    "/%61pi/site",
    "/api//site",
    "/%2e%2e/secret",
    "/%252e%252e/secret",
    "/a//b",
    "/_wss",
    "/_wss/health/",
    "/_wss/private",
    "/_wss%2fhealth",
    "/%5fwss/health",
    "/_wss//health"
  ]) {
    const f = fixture();
    const app = createRouterApplication({ store: f.store });
    const res = await run(app, request({ path }));
    assert.equal(res.statusCode, 404, path);
    assert.equal(f.calls.resolvePublicHost, 0, path);
    assert.match(res.getHeader("cache-control"), /no-store/);
  }
});

test("exact health path reports local production readiness without resolver I/O", async () => {
  const readyFixture = fixture();
  readyFixture.store.isReady = () => true;
  const readyApp = createRouterApplication({ store: readyFixture.store });
  const ready = await run(readyApp, request({
    host: "shared-site-router.vercel.app",
    path: "/_wss/health"
  }));
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(JSON.parse(ready.text()), {
    ok: true,
    service: "wss-shared-site-router",
    status: "ready"
  });
  assert.equal(ready.getHeader("content-type"), "application/json; charset=utf-8");
  assert.match(ready.getHeader("cache-control"), /no-store/);
  assert.equal(ready.getHeader("x-wss-site-id"), undefined);
  assert.equal(readyFixture.calls.resolvePublicHost, 0);

  const head = await run(readyApp, request({
    host: "shared-site-router.vercel.app",
    method: "HEAD",
    path: "/_wss/health"
  }));
  assert.equal(head.statusCode, 200);
  assert.equal(head.text(), "");
  assert.ok(Number(head.getHeader("content-length")) > 0);
  assert.equal(readyFixture.calls.resolvePublicHost, 0);

  const unavailableFixture = fixture();
  const unavailable = await run(
    createRouterApplication({ store: unavailableFixture.store }),
    request({ host: "shared-site-router.vercel.app", path: "/_wss/health" })
  );
  assert.equal(unavailable.statusCode, 503);
  assert.equal(JSON.parse(unavailable.text()).status, "not_ready");
  assert.equal(unavailableFixture.calls.resolvePublicHost, 0);
});

test("health path permits only GET and HEAD", async () => {
  const f = fixture();
  f.store.isReady = () => true;
  const res = await run(
    createRouterApplication({ store: f.store }),
    request({ method: "POST", path: "/_wss/health" })
  );
  assert.equal(res.statusCode, 405);
  assert.equal(res.getHeader("allow"), "GET, HEAD");
  assert.equal(f.calls.resolvePublicHost, 0);
});

test("only the exact preview-session path reaches the preview endpoint", async () => {
  const f = fixture();
  const app = createRouterApplication({ store: f.store });
  const exact = await run(app, request({ method: "GET", path: "/api/preview-session" }));
  assert.equal(exact.statusCode, 405);
  assert.equal(exact.getHeader("allow"), "POST");

  for (const path of ["/api/preview-session/", "/api%2fpreview-session", "/API/preview-session"]) {
    const res = await run(app, request({ path }));
    assert.equal(res.statusCode, 404, path);
  }
});
