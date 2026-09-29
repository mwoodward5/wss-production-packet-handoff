"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const adaptersPath = require.resolve("../lib/adapters");
const packetsPath = require.resolve("../lib/packets");
const storePath = require.resolve("../lib/store");

function canonicalJob() {
  const { buildCanonicalJob } = require(packetsPath);
  return buildCanonicalJob({
    jobId: "job_build_ticket_auth",
    prospect: {
      businessName: "Auth Proof Roofing",
      ownerEmail: "owner@example.com",
      industry: "roofing",
      city: "Dallas",
      state: "TX",
      services: ["roof repair"],
    },
  });
}

async function withHarness(env, run) {
  const originalAdapters = require.cache[adaptersPath];
  const originalStore = require.cache[storePath];
  const originalFetch = global.fetch;
  const keys = [
    "WOODWARD_LABS_BUILD_TICKET_URL",
    "WOODWARD_LABS_BUILD_TICKET_TOKEN",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const requests = [];
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    require.cache[storePath] = {
      id: storePath,
      filename: storePath,
      loaded: true,
      exports: { recordEvent: async () => ({ mode: "live_write" }) },
    };
    global.fetch = async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    delete require.cache[adaptersPath];
    await run(require(adaptersPath), requests);
  } finally {
    global.fetch = originalFetch;
    delete require.cache[adaptersPath];
    if (originalAdapters) require.cache[adaptersPath] = originalAdapters;
    if (originalStore) require.cache[storePath] = originalStore;
    else delete require.cache[storePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("build-ticket dispatch fails closed and never fetches when the token is absent", async () => {
  await withHarness({ WOODWARD_LABS_BUILD_TICKET_URL: "https://receiver.example.test/internal" }, async (adapters, requests) => {
    const result = await adapters.dispatchWoodwardLabsBuildTicket(canonicalJob());
    assert.equal(result.configured, false);
    assert.equal(result.mode, "configuration_blocked");
    assert.match(result.reason, /BUILD_TICKET_TOKEN not configured/);
    assert.equal(requests.length, 0);
  });
});

test("build-ticket dispatch always sends an exact Bearer token when configured", async () => {
  await withHarness({
    WOODWARD_LABS_BUILD_TICKET_URL: "https://receiver.example.test/internal",
    WOODWARD_LABS_BUILD_TICKET_TOKEN: "strong-shared-token",
  }, async (adapters, requests) => {
    const result = await adapters.dispatchWoodwardLabsBuildTicket(canonicalJob());
    assert.equal(result.configured, true);
    assert.equal(result.mode, "http_dispatch");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].init.headers.Authorization, "Bearer strong-shared-token");
    assert.notEqual(requests[0].init.headers.Authorization, undefined);
  });
});
