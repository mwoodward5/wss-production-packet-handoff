"use strict";

/**
 * test/dashboard-login-unreadable-store.test.js
 *
 * MEASURED on production, 2026-08-11, against a real provisioned account:
 *
 *   22:21:34  email + PIN 126036  ->  200, scoped token, dashboard loads
 *   22:23:02  the same two values ->  200
 *   22:24:xx  the same two values ->  401 invalid_credentials   (x4)
 *   22:26:xx  the same two values ->  200, scoped token
 *
 * Throughout, the stored pin_hash for that account was still exactly
 * sha256("126036") and the row still carried its site_slug. The credentials
 * were never wrong. The read of the account table was.
 *
 * lib/store select() reports a failed read as `{ ok: false }` rather than
 * throwing, and this route folded that into the same empty array as "no row
 * matched this email" — so a transport blip reached the customer as "your PIN
 * is wrong". The dashboard is the only door a paying customer has, and that
 * sentence sends them hunting for a credential that was never the problem.
 *
 * api/connect/edits.js already states the rule this route was missing: an
 * empty result and an unreadable one are different sentences.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { hashPin } = require("../lib/dashboard-link");

const STORE_PATH = require.resolve("../lib/store.js");
const ROUTE_PATH = require.resolve("../api/connect/dashboard-login.js");

const EMAIL = "owner@acme.com";
const PIN = "424242";

/** Load the route with lib/store replaced by a stub that answers `selectResult`. */
function loadRouteWith(selectResult) {
  const realStore = require.cache[STORE_PATH];
  delete require.cache[ROUTE_PATH];
  require.cache[STORE_PATH] = {
    id: STORE_PATH,
    filename: STORE_PATH,
    loaded: true,
    exports: {
      select: async () => selectResult,
      upsertRow: async () => ({ mode: "test" }),
    },
  };
  const handler = require(ROUTE_PATH);
  return {
    handler,
    restore() {
      delete require.cache[ROUTE_PATH];
      if (realStore) require.cache[STORE_PATH] = realStore;
      else delete require.cache[STORE_PATH];
    },
  };
}

/** Minimal req/res good enough for this handler. */
function call(handler, body) {
  return new Promise((resolve) => {
    const chunks = [];
    const req = {
      method: "POST",
      url: "/api/connect/dashboard-login",
      // lib/http readRawBody takes a pre-parsed body straight off req.body,
      // which is also how Vercel hands it over — no stream stub needed.
      body,
      headers: { origin: "https://wss-ai.com", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250) + 1}` },
      socket: {},
    };
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(chunk) {
        if (chunk) chunks.push(String(chunk));
        let json = null;
        try { json = JSON.parse(chunks.join("")); } catch { /* non-JSON */ }
        resolve({ status: this.statusCode, json, raw: chunks.join("") });
      },
    };
    Promise.resolve(handler(req, res)).catch(() => {});
  });
}

test("an unreadable account table is a 503 about us, never a 401 about their PIN", async () => {
  const { handler, restore } = loadRouteWith({ ok: false, error: "supabase_unreachable" });
  try {
    const out = await call(handler, { email: EMAIL, pin: PIN });
    assert.equal(out.status, 503, `expected 503, got ${out.status} ${out.raw}`);
    assert.equal(out.json.error, "account_lookup_unavailable");
    assert.match(out.json.message, /not your PIN/i, "the customer must be told this is not their credential");
    assert.notEqual(out.json.error, "invalid_credentials");
  } finally {
    restore();
  }
});

test("a genuinely wrong PIN is still a 401, and a right one still gets in", async () => {
  const rows = [{
    job_id: "prospect-acme",
    owner_email: EMAIL,
    site_slug: "acme-plumbing",
    business_name: "Acme Plumbing",
    pin_hash: hashPin(PIN),
  }];
  const { handler, restore } = loadRouteWith({ ok: true, data: rows });
  try {
    const wrong = await call(handler, { email: EMAIL, pin: "000000" });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.json.error, "invalid_credentials");

    const right = await call(handler, { email: EMAIL, pin: PIN });
    assert.equal(right.status, 200, `expected 200, got ${right.status} ${right.raw}`);
    assert.equal(right.json.ok, true);
    assert.equal(right.json.jobId, "prospect-acme");
  } finally {
    restore();
  }
});

test("an email with no account is a 401, not a 503 — an empty read is readable", async () => {
  const { handler, restore } = loadRouteWith({ ok: true, data: [] });
  try {
    const out = await call(handler, { email: "nobody@example.com", pin: PIN });
    assert.equal(out.status, 401);
    assert.equal(out.json.error, "invalid_credentials");
  } finally {
    restore();
  }
});

test("a malformed store answer is treated as unreadable, not as an empty account list", async () => {
  for (const bad of [null, undefined, {}, { ok: true }, { ok: true, data: "nope" }]) {
    const { handler, restore } = loadRouteWith(bad);
    try {
      const out = await call(handler, { email: EMAIL, pin: PIN });
      assert.equal(out.status, 503, `store answer ${JSON.stringify(bad)} should be unreadable, got ${out.status}`);
    } finally {
      restore();
    }
  }
});

test("the route under test is the real one", () => {
  assert.ok(ROUTE_PATH.endsWith(path.join("api", "connect", "dashboard-login.js")));
});
