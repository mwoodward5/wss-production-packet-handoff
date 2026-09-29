"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { fleetReadSummary } = require("../api/admin/fleet-read-probe");

test("fleet read probe exposes only aggregate, non-identifying backfill state", () => {
  const out = fleetReadSummary({
    ok: true,
    identities: [{ slug: "must-not-leak", h1: "Private Business", title: "Private Title" }],
    backfill: { attempted: 4, previewed: 1, written: 0, reused: 0, unresolved: 2, ambiguous: 1, reason: "Provider timeout" },
  });
  assert.deepEqual(out, {
    ok: true,
    identity_count: 1,
    reason: "",
    backfill: { attempted: 4, previewed: 1, written: 0, reused: 0, unresolved: 2, ambiguous: 1, reason: "provider_timeout" },
  });
  assert.equal(JSON.stringify(out).includes("must-not-leak"), false);
});

test("fleet read probe normalizes unavailable reasons", () => {
  assert.deepEqual(fleetReadSummary({ ok: false, reason: "HTTP 503: database unavailable", identities: [] }), {
    ok: false,
    identity_count: 0,
    reason: "http_503:_database_unavailable",
    backfill: null,
  });
});
