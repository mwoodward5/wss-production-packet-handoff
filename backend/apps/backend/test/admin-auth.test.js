"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");

const auth = require("../lib/admin-auth");

function request(headers = {}) {
  return { headers };
}

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(body) { this.body = body; },
  };
}

async function withAuthEnv(values, run) {
  const keys = [
    "GHOST_AGENCY_ADMIN_TOKEN",
    "GHOST_AGENCY_ADMIN_TOKEN_SECONDARY",
    "GHOST_AGENCY_ADMIN_TOKEN_SECONDARY_EXPIRES_AT",
    "VERCEL_ENV",
  ];
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, values);
    await run();
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

test("missing server admin tokens is a configuration failure, not an operator logout", async () => {
  await withAuthEnv({}, () => {
    const res = response();
    assert.equal(auth.requireAdmin(request({ authorization: "Bearer stale-client-token" }), res), false);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "server_auth_unconfigured" });
  });
});

test("invalid or expired supplied tokens remain unauthorized", async () => {
  await withAuthEnv({
    GHOST_AGENCY_ADMIN_TOKEN: "primary-token",
    GHOST_AGENCY_ADMIN_TOKEN_SECONDARY: "expired-secondary-token",
    GHOST_AGENCY_ADMIN_TOKEN_SECONDARY_EXPIRES_AT: "2000-01-01T00:00:00.000Z",
  }, () => {
    for (const headers of [
      {},
      { authorization: "Bearer wrong-token" },
      { "x-admin-token": "expired-secondary-token" },
    ]) {
      const res = response();
      assert.equal(auth.requireAdmin(request(headers), res), false);
      assert.equal(res.statusCode, 401);
      assert.deepEqual(JSON.parse(res.body), { ok: false, error: "unauthorized" });
    }
  });
});

test("primary and unexpired secondary tokens both remain valid", async () => {
  await withAuthEnv({
    GHOST_AGENCY_ADMIN_TOKEN: "primary-token",
    GHOST_AGENCY_ADMIN_TOKEN_SECONDARY: "secondary-token",
    GHOST_AGENCY_ADMIN_TOKEN_SECONDARY_EXPIRES_AT: "2999-01-01T00:00:00.000Z",
  }, () => {
    assert.equal(auth.adminAllowed(request({ authorization: "Bearer primary-token" })).allowed, true);
    assert.equal(auth.adminAllowed(request({ "x-admin-token": "secondary-token" })).allowed, true);
  });
});

test("recovery hashing is deterministic and recovery is production-only", async () => {
  const sample = "never-a-real-production-token";
  const expected = crypto.createHash("sha256").update(sample, "utf8").digest("hex");
  assert.equal(auth.sha256(sample), expected);

  await withAuthEnv({ VERCEL_ENV: "preview" }, () => {
    assert.equal(auth.recoveryEnabled(Date.parse("2026-09-01T00:00:00.000Z")), false);
  });
  await withAuthEnv({ VERCEL_ENV: "production" }, () => {
    assert.equal(auth.recoveryEnabled(Date.parse("2026-09-01T00:00:00.000Z")), true);
    assert.equal(auth.recoveryEnabled(Date.parse("2026-12-01T00:00:00.000Z")), false);
  });
});

test("committed owner recovery material is a digest, never a raw token", () => {
  assert.match(auth.OWNER_RECOVERY_SHA256, /^[a-f0-9]{64}$/);
  assert.ok(auth.OWNER_RECOVERY_EXPIRES_AT > Date.parse("2026-08-19T00:00:00.000Z"));
});
