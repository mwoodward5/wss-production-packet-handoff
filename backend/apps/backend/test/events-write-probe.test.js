"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { run } = require("../scripts/events-write-probe.cjs");

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return body; },
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function configuredProbe(t) {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldFetch = global.fetch;
  process.env.SUPABASE_URL = "https://probe-test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  t.after(() => {
    restoreEnv("SUPABASE_URL", oldUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    global.fetch = oldFetch;
  });
}

test("live_write pass prints the full store result and returns exit code 0", async (t) => {
  configuredProbe(t);
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return mockResponse(201, [{ id: "probe-row" }]);
  };

  const lines = [];
  const exitCode = await run({ write: (line) => lines.push(line) });

  assert.equal(exitCode, 0);
  assert.equal(lines.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://probe-test.supabase.co/rest/v1/ghost_agency_events");
  assert.equal(calls[0].options.method, "POST");
  const requestBody = JSON.parse(calls[0].options.body);
  assert.equal(requestBody.type, "probe.events_write");
  assert.equal(requestBody.payload.probe, true);
  assert.match(requestBody.payload.at, /^\d{4}-\d{2}-\d{2}T/);

  const output = JSON.parse(lines[0]);
  assert.equal(output.result.mode, "live_write");
  assert.deepEqual(output.result.row, [{ id: "probe-row" }]);
  assert.equal(output.classification.kind, "ok");
});

test("400 PostgREST failure prints status and message body excerpt without object coercion", async (t) => {
  configuredProbe(t);
  const secretLike = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  global.fetch = async () => mockResponse(400, {
    code: "PGRST204",
    message: "Could not find the required event column in the schema cache",
    details: `diagnostic token ${secretLike}`,
    hint: null,
  });

  const lines = [];
  const exitCode = await run({ argv: ["--type", "probe.custom", "--n", "9"], write: (line) => lines.push(line) });

  assert.equal(exitCode, 1);
  assert.equal(lines.length, 5, "--n is capped at five probes");
  for (const line of lines) {
    assert.equal(line.includes("[object Object]"), false);
    assert.equal(line.includes(secretLike), false);
    const output = JSON.parse(line);
    assert.equal(output.type, "probe.custom");
    assert.equal(output.result.mode, "live_write_failed");
    assert.equal(output.result.status, 400);
    assert.equal(output.classification.kind, "http");
    assert.equal(output.classification.status, 400);
    assert.match(output.classification.body_excerpt, /Could not find the required event column/);
    assert.match(output.classification.body_excerpt, /\[REDACTED\]/);
  }
});

test("missing Supabase env is classified cleanly as not-configured and never fetches", async (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldFetch = global.fetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async () => { throw new Error("fetch must not run when Supabase is not configured"); };
  t.after(() => {
    restoreEnv("SUPABASE_URL", oldUrl);
    restoreEnv("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    global.fetch = oldFetch;
  });

  const lines = [];
  const exitCode = await run({ write: (line) => lines.push(line) });

  assert.equal(exitCode, 1);
  assert.equal(lines.length, 1);
  const output = JSON.parse(lines[0]);
  assert.equal(output.result.mode, "dry_run");
  assert.equal(output.result.configured, false);
  assert.equal(output.classification.kind, "not-configured");
  assert.match(output.classification.reason, /SUPABASE_URL/);
});
