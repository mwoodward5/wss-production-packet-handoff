"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  heroWorkerAllowed,
  requireHeroWorker,
} = require("../lib/hero-worker-auth");
const { adminAllowed } = require("../lib/admin-auth");

const WORKER = "worker-only-secret";
const ADMIN = "owner-only-secret";

function responseHarness() {
  const captured = { status: 0, body: null };
  return {
    captured,
    statusCode: 200,
    setHeader() {},
    end(body) {
      captured.status = this.statusCode;
      captured.body = JSON.parse(String(body));
    },
  };
}

test("worker auth accepts only its dedicated header and dedicated secret", () => {
  const env = { GHOST_AGENCY_HERO_WORKER_TOKEN: WORKER, GHOST_AGENCY_ADMIN_TOKEN: ADMIN };
  assert.equal(heroWorkerAllowed({ headers: { "x-ghost-hero-worker-token": WORKER } }, env).allowed, true);
  assert.equal(heroWorkerAllowed({ headers: { authorization: `Bearer ${WORKER}` } }, env).allowed, false);
  assert.equal(heroWorkerAllowed({ headers: { "x-ghost-hero-worker-token": ADMIN } }, env).allowed, false);
  assert.equal(heroWorkerAllowed({ headers: { authorization: `Bearer ${ADMIN}` } }, env).allowed, false);
});

test("worker auth fails closed when missing or reused from the owner lane", () => {
  const missing = responseHarness();
  assert.equal(requireHeroWorker({ headers: {} }, missing, {}), false);
  assert.equal(missing.captured.status, 503);
  assert.equal(missing.captured.body.error, "server_worker_auth_unconfigured");

  const collision = responseHarness();
  assert.equal(requireHeroWorker(
    { headers: { "x-ghost-hero-worker-token": WORKER } },
    collision,
    { GHOST_AGENCY_HERO_WORKER_TOKEN: WORKER, GHOST_AGENCY_ADMIN_TOKEN: WORKER },
  ), false);
  assert.equal(collision.captured.status, 503);
  assert.equal(collision.captured.body.error, "worker_auth_credential_collision");
});

test("the worker credential cannot authorize an owner approval", () => {
  const saved = {
    admin: process.env.GHOST_AGENCY_ADMIN_TOKEN,
    secondary: process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY,
    session: process.env.GHOST_AGENCY_ADMIN_SESSION_SECRET,
    vercel: process.env.VERCEL_ENV,
  };
  try {
    process.env.GHOST_AGENCY_ADMIN_TOKEN = ADMIN;
    delete process.env.GHOST_AGENCY_ADMIN_TOKEN_SECONDARY;
    delete process.env.GHOST_AGENCY_ADMIN_SESSION_SECRET;
    process.env.VERCEL_ENV = "development";
    assert.equal(adminAllowed({ headers: { "x-ghost-hero-worker-token": WORKER } }).allowed, false);
    assert.equal(adminAllowed({ headers: { authorization: `Bearer ${WORKER}` } }).allowed, false);
    assert.equal(adminAllowed({ headers: { authorization: `Bearer ${ADMIN}` } }).allowed, true);
  } finally {
    for (const [key, value] of Object.entries({
      GHOST_AGENCY_ADMIN_TOKEN: saved.admin,
      GHOST_AGENCY_ADMIN_TOKEN_SECONDARY: saved.secondary,
      GHOST_AGENCY_ADMIN_SESSION_SECRET: saved.session,
      VERCEL_ENV: saved.vercel,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
