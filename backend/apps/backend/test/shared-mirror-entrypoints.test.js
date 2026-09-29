"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { injectDefaultSharedPublisher } = require("../lib/shared-mirror-publisher");
const line = require("../lib/line-mirror-resume");

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    end(value = "") { this.body += String(value); },
  };
}

function post(body, query = "") {
  return {
    method: "POST",
    url: `/api/mirror${query}`,
    headers: {},
    body,
  };
}

test("shared publisher injector is default-on, cached, dry-run safe and exact-0 off", () => {
  const first = injectDefaultSharedPublisher({}, { env: {} });
  const second = injectDefaultSharedPublisher({}, { env: {} });
  assert.ok(first.sharedPublisher && typeof first.sharedPublisher === "object");
  assert.equal(first.sharedPublisher, second.sharedPublisher, "one process reuses one production publisher");
  assert.equal(Object.prototype.hasOwnProperty.call(
    injectDefaultSharedPublisher({}, { env: {}, dryRun: true }),
    "sharedPublisher",
  ), false);
  assert.equal(Object.prototype.hasOwnProperty.call(
    injectDefaultSharedPublisher({}, { env: { GHOST_AGENCY_SHARED_MIRROR_DEFAULT: "0" } }),
    "sharedPublisher",
  ), false);
});

test("direct API and durable Line production entries inject shared while dry-run calls neither lane", async () => {
  const enginePath = require.resolve("../lib/mirror-engine/engine");
  const routePath = require.resolve("../api/mirror");
  const originalEngine = require(enginePath);
  const seen = [];
  const fakeMirror = async (_request, options) => {
    seen.push(options);
    return { ok: true, status: 200, body: { ok: true, revealable: false } };
  };
  const previous = process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;

  try {
    require.cache[enginePath].exports = { ...originalEngine, mirror: fakeMirror };
    delete require.cache[routePath];
    const api = require(routePath).createMirrorHandler({ requireAdmin: () => true });

    delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    const liveResponse = response();
    await api(post({ slug: "wss-test-direct-api", facts: {} }), liveResponse);
    assert.equal(liveResponse.statusCode, 200);
    assert.ok(seen[0].deps.sharedPublisher, "live API call did not select shared publisher");

    const lineResult = await line.lineEngineMirror({ slug: "wss-test-direct-line" });
    assert.equal(lineResult.status, 200);
    assert.ok(seen[1].deps.sharedPublisher, "durable Line call did not select shared publisher");

    const dryResponse = response();
    await api(post({ slug: "wss-test-direct-dry" }, "?dry_run=1"), dryResponse);
    assert.equal(dryResponse.statusCode, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(seen[2].deps, "sharedPublisher"), false);

    process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = "0";
    const legacyResponse = response();
    await api(post({ slug: "wss-test-direct-legacy", facts: {} }), legacyResponse);
    assert.equal(legacyResponse.statusCode, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(seen[3].deps, "sharedPublisher"), false);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT;
    else process.env.GHOST_AGENCY_SHARED_MIRROR_DEFAULT = previous;
    require.cache[enginePath].exports = originalEngine;
    delete require.cache[routePath];
  }
});

test("explicit shared test dependency survives both direct entry points with zero legacy calls", async () => {
  const sharedPublisher = Object.freeze({ supportsTwoPhaseQc: true, stage() {}, activate() {} });
  let legacyCalls = 0;
  const deps = {
    sharedPublisher,
    ensureProject: async () => { legacyCalls += 1; },
    uploadFiles: async () => { legacyCalls += 1; },
    createDeployment: async () => { legacyCalls += 1; },
  };
  const seen = [];
  const fakeMirror = async (_request, options) => {
    seen.push(options.deps);
    return { ok: true, status: 200, body: { ok: true } };
  };

  const { createMirrorHandler } = require("../api/mirror");
  const api = createMirrorHandler({
    mirror: fakeMirror,
    requireAdmin: () => true,
    deps,
  });
  const res = response();
  await api(post({ slug: "wss-test-injected-api", facts: {} }), res);
  await line.lineEngineMirror({ slug: "wss-test-injected-line" }, {
    mirrorEngine: fakeMirror,
    deps,
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].sharedPublisher, sharedPublisher);
  assert.equal(seen[1].sharedPublisher, sharedPublisher);
  assert.equal(legacyCalls, 0);
});
