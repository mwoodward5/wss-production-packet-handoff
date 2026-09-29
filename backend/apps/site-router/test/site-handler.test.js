"use strict";

const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const test = require("node:test");
const { createSiteHandler } = require("../lib/site-handler");
const { RESPONSE_CHUNK_BYTES } = require("../lib/stream");
const { encodeToken } = require("../lib/token");
const { PREVIEW_COOKIE, PREVIEW_SESSION_AUDIENCE } = require("../lib/constants");
const {
  BUILD_HASH,
  HOST,
  MockResponse,
  RELEASE_ID,
  SITE_ID,
  fixture,
  request,
  sha256
} = require("./helpers");

const SECRET = "router-test-secret-that-is-at-least-32-bytes";
const ENV = { WSS_SITE_PREVIEW_SECRET: SECRET, WSS_SHARED_SITE_ENV: "test" };

async function run(handler, req) {
  const res = new MockResponse();
  await handler(req, res);
  return res;
}

test("direct, reserved, multi-label, and malformed hosts fail before storage lookup", async () => {
  for (const host of ["wss-ai.com", "www.wss-ai.com", "a.b.wss-ai.com", "router.vercel.app", "bad host"] ) {
    const f = fixture();
    const res = await run(createSiteHandler({ store: f.store }), request({ host }));
    assert.equal(res.statusCode, 404, host);
    assert.equal(f.calls.resolvePublicHost, 0, host);
    assert.match(res.getHeader("cache-control"), /no-store/);
    assert.equal(res.getHeader("vercel-cdn-cache-control"), "no-store");
  }
});

test("invalid traversal fails before host or manifest lookup", async () => {
  for (const path of ["/../x", "/%2e%2e/x", "/%252e%252e/x", "/a%2fb", "/a\\b", "/a//b"]) {
    const f = fixture();
    const res = await run(createSiteHandler({ store: f.store }), request({ path, rewrittenPath: path }));
    assert.equal(res.statusCode, 404, path);
    assert.equal(f.calls.resolvePublicHost, 0, path);
  }
});

test("unknown site and unlisted routes fail closed and never open an asset", async () => {
  const unknown = fixture();
  const res1 = await run(createSiteHandler({ store: unknown.store }), request({ host: "unknown.wss-ai.com" }));
  assert.equal(res1.statusCode, 404);
  assert.equal(unknown.calls.readManifest, 0);

  const f = fixture({ routes: { "/": "index.html" } });
  const res2 = await run(createSiteHandler({ store: f.store }), request({ path: "/assets/app.css", rewrittenPath: "/assets/app.css" }));
  assert.equal(res2.statusCode, 404);
  assert.equal(f.calls.openAsset, 0);
});

test("GET serves only the manifest target with no-store and identity headers", async () => {
  const f = fixture();
  const res = await run(createSiteHandler({ store: f.store }), request());
  assert.equal(res.statusCode, 200);
  assert.equal(res.text(), f.assetBodies["index.html"].toString());
  assert.equal(res.getHeader("x-wss-site-id"), SITE_ID);
  assert.equal(res.getHeader("x-wss-release-id"), RELEASE_ID);
  assert.equal(res.getHeader("x-wss-build-hash"), BUILD_HASH);
  assert.equal(res.getHeader("x-wss-route-generation"), "7");
  assert.match(res.getHeader("cache-control"), /^public,.*no-store/);
  assert.equal(res.getHeader("content-type"), "text/html; charset=utf-8");
  assert.equal(f.calls.openAsset, 1);
});

test("verified bytes use SHA-attested manifest MIME despite normalized storage transport MIME", async () => {
  const html = fixture();
  const openHtml = html.store.openAsset;
  html.store.openAsset = async (...args) => ({
    ...await openHtml(...args),
    contentType: "text/plain; charset=utf-8"
  });
  const htmlResponse = await run(createSiteHandler({ store: html.store }), request());
  assert.equal(htmlResponse.statusCode, 200);
  assert.equal(htmlResponse.text(), html.assetBodies["index.html"].toString());
  assert.equal(htmlResponse.getHeader("content-type"), "text/html; charset=utf-8");

  const xmlBody = Buffer.from("<?xml version=\"1.0\"?><urlset></urlset>");
  const sitemap = fixture({
    bodies: { "sitemap.xml": xmlBody },
    routes: { "/sitemap.xml": "sitemap.xml" }
  });
  sitemap.files["sitemap.xml"].mime = "application/xml; charset=utf-8";
  sitemap.manifestBody = Buffer.from(JSON.stringify(sitemap.manifest));
  sitemap.release.manifestSha256 = sha256(sitemap.manifestBody);
  sitemap.store.readManifest = async () => ({ body: sitemap.manifestBody });
  const openSitemap = sitemap.store.openAsset;
  sitemap.store.openAsset = async (...args) => ({
    ...await openSitemap(...args),
    contentType: "application/octet-stream"
  });
  const sitemapResponse = await run(createSiteHandler({ store: sitemap.store }), request({
    path: "/sitemap.xml"
  }));
  assert.equal(sitemapResponse.statusCode, 200);
  assert.equal(sitemapResponse.text(), xmlBody.toString());
  assert.equal(sitemapResponse.getHeader("content-type"), "application/xml; charset=utf-8");
});

test("main document and asset responses carry the exact backend proof identity", async () => {
  for (const path of ["/", "/assets/app.css"]) {
    const f = fixture();
    const res = await run(createSiteHandler({ store: f.store }), request({ path }));
    assert.equal(res.statusCode, 200, path);
    assert.deepEqual({
      site_id: res.getHeader("x-wss-site-id"),
      release_id: res.getHeader("x-wss-release-id"),
      build_hash: res.getHeader("x-wss-build-hash"),
      generation: res.getHeader("x-wss-route-generation")
    }, {
      site_id: SITE_ID,
      release_id: RELEASE_ID,
      build_hash: BUILD_HASH,
      generation: "7"
    }, path);
  }
});

test("HEAD and matching ETag verify the full object before claiming a representation", async () => {
  const headFixture = fixture();
  const head = await run(createSiteHandler({ store: headFixture.store }), request({ method: "HEAD" }));
  assert.equal(head.statusCode, 200);
  assert.equal(head.text(), "");
  assert.equal(head.getHeader("content-length"), String(headFixture.assetBodies["index.html"].length));
  assert.equal(headFixture.calls.openAsset, 1);

  const etagFixture = fixture();
  const etag = `"${etagFixture.files["index.html"].sha256}"`;
  const cached = await run(createSiteHandler({ store: etagFixture.store }), request({ headers: { "if-none-match": `W/${etag}` } }));
  assert.equal(cached.statusCode, 304);
  assert.equal(cached.text(), "");
  assert.equal(etagFixture.calls.openAsset, 1);
});

test("one bounded byte range returns 206; invalid and multiple byte ranges return 416", async () => {
  const f = fixture();
  const partial = await run(createSiteHandler({ store: f.store }), request({ headers: { range: "bytes=2-8" } }));
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.getHeader("content-range"), `bytes 2-8/${f.assetBodies["index.html"].length}`);
  assert.deepEqual(Buffer.from(partial.text()), f.assetBodies["index.html"].subarray(2, 9));

  for (const range of ["bytes=0-1,4-5", "bytes=9999-"]) {
    const invalidFixture = fixture();
    const invalid = await run(createSiteHandler({ store: invalidFixture.store }), request({ headers: { range } }));
    assert.equal(invalid.statusCode, 416, range);
    assert.equal(invalidFixture.calls.openAsset, 1, range);
  }
});

test("HEAD and unknown range units ignore Range after full integrity proof", async () => {
  const headFixture = fixture();
  const head = await run(createSiteHandler({ store: headFixture.store }), request({
    method: "HEAD",
    headers: { range: "bytes=0-2" }
  }));
  assert.equal(head.statusCode, 200);
  assert.equal(head.getHeader("content-range"), undefined);
  assert.equal(head.getHeader("content-length"), String(headFixture.assetBodies["index.html"].length));
  assert.equal(headFixture.calls.openAsset, 1);

  const extensionFixture = fixture();
  const extension = await run(createSiteHandler({ store: extensionFixture.store }), request({
    headers: { range: "items=0-1" }
  }));
  assert.equal(extension.statusCode, 200);
  assert.equal(extension.getHeader("content-range"), undefined);
  assert.equal(extension.text(), extensionFixture.assetBodies["index.html"].toString());
  assert.equal(extensionFixture.calls.openAsset, 1);
});

test("corrupt bytes fail before HEAD, 304, or 416 representation metadata", async () => {
  const cases = [
    { method: "HEAD", headers: {} },
    { method: "GET", headers: { "if-none-match": null } },
    { method: "GET", headers: { range: "bytes=0-1,4-5" } }
  ];
  for (const item of cases) {
    const f = fixture();
    if (Object.hasOwn(item.headers, "if-none-match")) {
      item.headers["if-none-match"] = `W/"${f.files["index.html"].sha256}"`;
    }
    f.store.openAsset = async (_release, file) => ({
      body: Buffer.alloc(file.bytes, 0x78),
      size: file.bytes,
      contentType: file.mime,
      sha256: file.sha256
    });
    const res = await run(createSiteHandler({ store: f.store }), request(item));
    assert.equal(res.statusCode, 503, `${item.method} ${JSON.stringify(item.headers)}`);
    assert.equal(res.getHeader("x-wss-site-id"), undefined);
    assert.equal(res.getHeader("etag"), undefined);
    assert.equal(res.getHeader("content-range"), undefined);
  }
});

test("a satisfiable open range larger than 8 MiB returns a bounded 206", async () => {
  const body = Buffer.alloc(9 * 1024 * 1024, 0x61);
  const f = fixture({ bodies: { "video.mp4": body }, routes: { "/": "video.mp4" } });
  f.files["video.mp4"].mime = "video/mp4";
  f.manifest.files["video.mp4"].mime = "video/mp4";
  f.manifestBody = Buffer.from(JSON.stringify(f.manifest));
  f.release.manifestSha256 = require("./helpers").sha256(f.manifestBody);
  f.store.readManifest = async () => ({ body: f.manifestBody });

  const res = await run(createSiteHandler({ store: f.store }), request({ headers: { range: "bytes=0-" } }));
  assert.equal(res.statusCode, 206);
  assert.equal(res.getHeader("content-range"), `bytes 0-${8 * 1024 * 1024 - 1}/${body.length}`);
  assert.equal(res.chunks.reduce((sum, chunk) => sum + chunk.length, 0), 8 * 1024 * 1024);
});

test("verified full and range bodies above 4.5 MiB stream in bounded writes", async () => {
  const body = Buffer.alloc(6 * 1024 * 1024, 0x61);
  const rangeLength = 5 * 1024 * 1024;
  const cases = [
    { headers: {}, statusCode: 200, expected: body },
    {
      headers: { range: `bytes=0-${rangeLength - 1}` },
      statusCode: 206,
      expected: body.subarray(0, rangeLength)
    }
  ];

  for (const item of cases) {
    const f = fixture({ bodies: { "video.mp4": body }, routes: { "/": "video.mp4" } });
    f.files["video.mp4"].mime = "video/mp4";
    f.manifest.files["video.mp4"].mime = "video/mp4";
    f.manifestBody = Buffer.from(JSON.stringify(f.manifest));
    f.release.manifestSha256 = require("./helpers").sha256(f.manifestBody);
    f.store.readManifest = async () => ({ body: f.manifestBody });

    const res = new MockResponse();
    const writeSizes = [];
    const endChunks = [];
    const originalWrite = res.write;
    const originalEnd = res.end;
    res.write = function write(chunk, ...args) {
      writeSizes.push(Buffer.byteLength(chunk));
      return originalWrite.call(this, chunk, ...args);
    };
    res.end = function end(chunk, ...args) {
      endChunks.push(chunk);
      return originalEnd.call(this, chunk, ...args);
    };

    await createSiteHandler({ store: f.store })(request({ headers: item.headers }), res);

    assert.equal(res.statusCode, item.statusCode);
    assert.equal(res.getHeader("content-length"), String(item.expected.length));
    assert.equal(endChunks.length, 1);
    assert.equal(endChunks[0], undefined, "the verified body must never be passed to res.end");
    assert.ok(writeSizes.length > 1, "large responses must use multiple writes");
    assert.ok(Math.max(...writeSizes) <= RESPONSE_CHUNK_BYTES);
    assert.equal(writeSizes.reduce((sum, length) => sum + length, 0), item.expected.length);
    assert.deepEqual(Buffer.concat(res.chunks), item.expected);
  }
});

test("If-Range mismatch safely returns the complete object", async () => {
  const f = fixture();
  const res = await run(createSiteHandler({ store: f.store }), request({
    headers: { range: "bytes=0-2", "if-range": '"old"' }
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.text(), f.assetBodies["index.html"].toString());
});

test("stream bodies are piped and wrong size or hash metadata is rejected", async () => {
  const streamed = fixture();
  const original = streamed.store.openAsset;
  streamed.store.openAsset = async (...args) => {
    const result = await original(...args);
    return { ...result, body: Readable.from([result.body.subarray(0, 4), result.body.subarray(4)]) };
  };
  const okay = await run(createSiteHandler({ store: streamed.store }), request());
  assert.equal(okay.statusCode, 200);
  assert.equal(okay.text(), streamed.assetBodies["index.html"].toString());

  for (const mismatchMetadata of [
    (file) => ({ size: file.bytes + 1, sha256: file.sha256 }),
    (file) => ({ size: file.bytes, sha256: "0".repeat(64) })
  ]) {
    const mismatch = fixture();
    mismatch.store.openAsset = async (_release, file) => ({
      body: mismatch.assetBodies[file.filePath],
      contentType: file.mime,
      ...mismatchMetadata(file)
    });
    const refused = await run(createSiteHandler({ store: mismatch.store }), request());
    assert.equal(refused.statusCode, 503);
    assert.equal(refused.text(), "Service Unavailable");
    assert.equal(refused.getHeader("content-type"), "text/plain; charset=utf-8");
    assert.equal(refused.getHeader("x-wss-site-id"), undefined);
  }
});

test("same-length wrong bytes fail before identity headers for full and range responses", async () => {
  for (const [headers, streamed] of [[{}, false], [{ range: "bytes=0-3" }, true]]) {
    const f = fixture();
    f.store.openAsset = async (_release, file) => {
      const wrong = Buffer.alloc(file.bytes, 0x78);
      return {
        body: streamed ? Readable.from([wrong]) : wrong,
        size: file.bytes,
        contentType: file.mime,
        sha256: file.sha256
      };
    };
    const res = await run(createSiteHandler({ store: f.store }), request({ headers }));
    assert.equal(res.statusCode, 503);
    assert.equal(res.text(), "Service Unavailable");
    assert.equal(res.getHeader("x-wss-site-id"), undefined);
    assert.equal(res.getHeader("content-range"), undefined);
  }
});

test("router headers use resolver generation across A to B to immutable A rollback", async () => {
  const releaseA = fixture({
    releaseId: "release_A",
    buildHash: "a".repeat(64),
    routeGeneration: 1,
    manifestRouteGeneration: 1,
    bodies: { "index.html": Buffer.from("release A") },
    routes: { "/": "index.html" }
  });
  const releaseB = fixture({
    releaseId: "release_B",
    buildHash: "c".repeat(64),
    routeGeneration: 2,
    manifestRouteGeneration: 2,
    bodies: { "index.html": Buffer.from("release B") },
    routes: { "/": "index.html" }
  });
  let active = releaseA;
  const store = {
    async resolvePublicHost() { return active.release; },
    async resolvePreviewRelease() { return null; },
    async readManifest() { return { body: active.manifestBody }; },
    async openAsset(_release, file) {
      const body = active.assetBodies[file.filePath];
      return { body, size: body.length, contentType: file.mime, sha256: file.sha256 };
    },
    async consumePreviewGrant() { return false; }
  };
  const handler = createSiteHandler({ store });

  const firstA = await run(handler, request());
  assert.equal(firstA.getHeader("x-wss-route-generation"), "1");
  assert.equal(firstA.text(), "release A");

  active = releaseB;
  const b = await run(handler, request());
  assert.equal(b.getHeader("x-wss-route-generation"), "2");
  assert.equal(b.text(), "release B");

  active = releaseA;
  active.release = { ...active.release, routeGeneration: 3 };
  const rolledBackA = await run(handler, request());
  assert.equal(rolledBackA.getHeader("x-wss-route-generation"), "3");
  assert.equal(rolledBackA.text(), "release A");
  assert.equal(active.manifest.route_generation, 1, "immutable history was not rewritten to current generation");
});

test("client abort is forwarded to the storage adapter", async () => {
  const f = fixture();
  let capturedSignal;
  f.store.resolvePublicHost = async (_host, { signal }) => {
    capturedSignal = signal;
    await new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    return null;
  };
  const handler = createSiteHandler({ store: f.store });
  const req = request();
  const res = new MockResponse();
  const pending = handler(req, res);
  await new Promise((resolve) => setImmediate(resolve));
  req.emit("aborted");
  await pending;
  assert.equal(capturedSignal.aborted, true);
  assert.equal(res.statusCode, 503);
  assert.equal(f.calls.openAsset, 0);
});

test("preview session cookie is host-bound and produces private no-store output", async () => {
  const now = 2_000_000_000;
  const session = encodeToken({
    v: 1,
    aud: PREVIEW_SESSION_AUDIENCE,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: "honest-fence",
    env: "test",
    jti: "session_1",
    iat: now,
    exp: now + 300
  }, SECRET);
  const f = fixture();
  const handler = createSiteHandler({ store: f.store, env: ENV, nowSeconds: () => now });
  const res = await run(handler, request({ cookie: `${PREVIEW_COOKIE}=${session}` }));
  assert.equal(res.statusCode, 200);
  assert.match(res.getHeader("cache-control"), /^private,.*no-store/);
  assert.equal(f.calls.resolvePreviewRelease, 1);
  assert.equal(f.calls.resolvePublicHost, 0);

  const overlong = encodeToken({
    v: 1,
    aud: PREVIEW_SESSION_AUDIENCE,
    site_id: SITE_ID,
    release_id: RELEASE_ID,
    build_hash: BUILD_HASH,
    slug: "honest-fence",
    env: "test",
    jti: "session_overlong",
    iat: now,
    exp: now + 301
  }, SECRET);
  const overlongRes = await run(handler, request({ cookie: `${PREVIEW_COOKIE}=${overlong}` }));
  assert.equal(overlongRes.statusCode, 404);
  assert.equal(f.calls.resolvePreviewRelease, 1, "overlong session must fail before resolver I/O");
  assert.equal(f.calls.resolvePublicHost, 0, "invalid preview cookie must not fall back to public");

  const wrongHost = await run(handler, request({
    cookie: `${PREVIEW_COOKIE}=${session}`,
    host: "another-site.wss-ai.com"
  }));
  assert.equal(wrongHost.statusCode, 404);
  assert.equal(f.calls.resolvePublicHost, 0);
});

test("missing production adapter fails closed", async () => {
  const handler = require("../api/index");
  const res = await run(handler, request());
  assert.equal(res.statusCode, 503);
  assert.match(res.getHeader("cache-control"), /no-store/);
});

test("preview environment uses WSS_SHARED_SITE_ENV and conflicting legacy env fails startup", () => {
  assert.throws(() => createSiteHandler({
    store: fixture().store,
    env: { WSS_SHARED_SITE_ENV: "preview", WSS_SITE_ROUTER_ENV: "production" }
  }), /shared_site_environment_mismatch/);
});
