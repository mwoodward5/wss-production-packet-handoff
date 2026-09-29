"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { identityFor, retirementRecord, executeRetirement } = require("../lib/site-retirement");

const row = {
  prospect_id: "wss-test-cedar-plumbing-austin",
  record: {
    prospect_id: "wss-test-cedar-plumbing-austin",
    site_slug: "wss-test-cedar-plumbing-austin",
    preview_project_name: "wss-test-cedar-plumbing-austin",
  },
};

test("retirement accepts only the exact legacy slug/project/hostname identity", () => {
  assert.deepEqual(identityFor(row), {
    prospectId: "wss-test-cedar-plumbing-austin",
    slug: "wss-test-cedar-plumbing-austin",
    projectName: "wss-test-cedar-plumbing-austin",
    hostname: "wss-test-cedar-plumbing-austin.wss-ai.com",
    sharedSiteId: "",
  });
  assert.equal(identityFor({ prospect_id: "p-1", record: { preview_project_name: "ghost-agency-backend" } }).slug, "");
});

test("retirement keeps a durable suppression tombstone shape", () => {
  const record = retirementRecord(row, { now: new Date("2026-08-29T00:00:00.000Z") });
  assert.equal(record.state, "retiring");
  assert.equal(record.suppression, true);
  assert.equal(record.hostname, "wss-test-cedar-plumbing-austin.wss-ai.com");
});

test("retirement completes only after legacy project, source, fleet, and host steps succeed", async () => {
  const calls = [];
  const out = await executeRetirement(row, {
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    teardownProject: async (input) => { calls.push(["project", input]); return { ok: true }; },
    purgeSource: async (slug) => { calls.push(["source", slug]); return { ok: true }; },
    retireFleet: async (input) => { calls.push(["fleet", input]); return { ok: true }; },
    retireSharedHost: async (input) => { calls.push(["host", input.slug]); return { ok: true, skipped: true }; },
  });
  assert.equal(out.ok, true);
  assert.equal(out.state, "retired");
  assert.deepEqual(calls.map(([name]) => name), ["project", "source", "fleet", "host"]);
});

test("external failure is pending and never reports the site deleted", async () => {
  const out = await executeRetirement(row, {
    teardownProject: async () => ({ ok: false }),
    purgeSource: async () => { throw new Error("must not purge after Vercel failure"); },
  });
  assert.equal(out.ok, false);
  assert.equal(out.state, "retiring");
  assert.equal(out.reason, "vercel_teardown_failed");
});
