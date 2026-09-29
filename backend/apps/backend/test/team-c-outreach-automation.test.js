"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_COOLDOWN_DAYS,
  cooldownDays,
  cooldownStatus,
  dedupeProspects,
  durableClaimProspectSend,
  durableEligibility,
  finishDurableProspectSend,
  releaseDurableProspectSend,
  stableIdentity,
} = require("../lib/outreach-identity-guard");
const { forceOwnerRecipient, assertOwnerOnly } = require("../lib/sandbox-send");

const NOW = Date.parse("2026-08-16T12:00:00Z");
const ENV = { SUPABASE_URL: "https://project.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "service-key", OUTREACH_COOLDOWN_DAYS: "21" };
const response = (value, ok = true, status = 200) => ({ ok, status, async json() { return value; } });

test("stable identity prioritizes Place ID then domain", () => {
  assert.equal(stableIdentity({ place_id: "ChIJ123", website: "https://www.Example.com/a" }).key, "place:ChIJ123");
  assert.equal(stableIdentity({ website: "https://www.Example.com/a" }).key, "domain:example.com");
});

test("100-row batch dedupes repeated normalized domains", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ website: `https://www.company${i % 50}.example/path/${i}` }));
  const out = dedupeProspects(rows);
  assert.equal(out.accepted.length, 50);
  assert.equal(out.duplicates.length, 50);
});

test("cooldown defaults to 30 and is configurable", () => {
  assert.equal(DEFAULT_COOLDOWN_DAYS, 30);
  assert.equal(cooldownDays({}), 30);
  assert.equal(cooldownDays({ OUTREACH_COOLDOWN_DAYS: "21" }), 21);
});

test("recent contact is blocked and expired contact is eligible", () => {
  const recent = new Date(NOW - 2 * 86400e3).toISOString();
  const old = new Date(NOW - 31 * 86400e3).toISOString();
  assert.equal(cooldownStatus([{ last_contacted_at: recent }], { now: NOW, env: {} }).reason, "cooldown_active");
  assert.equal(cooldownStatus([{ last_contacted_at: old }], { now: NOW, env: {} }).eligible, true);
});

test("suppression outranks elapsed cooldown", () => {
  const old = new Date(NOW - 100 * 86400e3).toISOString();
  const status = cooldownStatus([{ last_contacted_at: old, suppressed: true }], { now: NOW, env: {} });
  assert.equal(status.eligible, false);
});

test("durable eligibility fails closed when storage is unavailable", async () => {
  const status = await durableEligibility({ website: "abc.example" }, { env: {}, fetchImpl: null, now: NOW });
  assert.equal(status.eligible, false);
  assert.equal(status.failClosed, true);
});

test("atomic durable claim sends stable identity and cooldown", async () => {
  let body;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return response([{ ok: true, reason: "claimed" }]); };
  const result = await durableClaimProspectSend({ prospect_id: "p1", website: "https://www.ABC.example/a" }, "worker-1", { env: ENV, fetchImpl, leaseSeconds: 120 });
  assert.equal(result.ok, true);
  assert.equal(body.p_identity_key, "domain:abc.example");
  assert.equal(body.p_cooldown_days, 21);
});

test("successful send finalizes durable identity", async () => {
  let body;
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return response(true); };
  assert.equal(await finishDurableProspectSend({ website: "abc.example" }, "worker", { sendId: "resend-1", creativeFingerprint: "creative-1", env: ENV, fetchImpl }), true);
  assert.equal(body.p_send_id, "resend-1");
});

test("failed send releases claim without contact finalization", async () => {
  let body;
  const fetchImpl = async (_url, init) => { body = JSON.parse(init.body); return response(true); };
  assert.equal(await releaseDurableProspectSend({ website: "abc.example" }, "worker", { env: ENV, fetchImpl }), true);
  assert.equal(body.p_claim_token, "worker");
});

test("sandbox rewrites every prospect recipient to owner", () => {
  const owner = "owner@example.com";
  const p = forceOwnerRecipient({ email: "prospect@example.com", ownerEmail: "other@example.com" }, owner);
  assert.equal(assertOwnerOnly(p, owner), true);
  assert.equal(p.email, owner);
});
