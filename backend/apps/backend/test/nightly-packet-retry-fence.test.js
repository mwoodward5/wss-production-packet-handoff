"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { packetProspectForConsent } = require("../lib/full-run");
const { processNightlyProspect } = require("../api/cron/nightly-pipeline");

test("a failed nightly certification is durably parked and the next cron makes zero provider calls", async () => {
  const canonical = {
    prospect_id: "prospect-parked",
    business_name: "Parked Roofing",
    industry: "roofing",
    email: "owner@parkedroofing.com",
    status: "new",
    updated_at: "2026-08-29T12:00:00.000Z",
    record: { business_name: "Parked Roofing", status: "new" },
  };
  let providerCalls = 0;
  let parkedPatch = null;
  const first = await packetProspectForConsent(canonical, {
    source: "nightly_pipeline_consent_first",
    requireCanonicalGuard: true,
    parkOnFailure: true,
    now: () => Date.parse("2026-08-29T12:01:00.000Z"),
    select: async () => ({ ok: true, data: [structuredClone(canonical)] }),
    conditionalUpdate: async (_table, _column, _id, _guards, patch) => {
      parkedPatch = structuredClone(patch);
      return { ok: true, updated: true, rows: [patch] };
    },
    truthPacketWithLocalPlan: async () => {
      providerCalls += 1;
      throw Object.assign(new Error("certifier unavailable"), { code: "intake_genie_unavailable" });
    },
  });

  assert.equal(first.ok, false);
  assert.equal(first.persistence, "parked");
  assert.equal(parkedPatch.status, "held");
  assert.equal(parkedPatch.record.consent_packet_hold.schema, "wss.consent_packet_hold.v1");
  assert.equal(providerCalls, 1);

  let repeatedProviderCalls = 0;
  const second = await processNightlyProspect({
    ...canonical,
    ...parkedPatch,
  }, {
    stages: null,
    packetProspect: async () => {
      repeatedProviderCalls += 1;
      throw new Error("must_not_repeat_intake");
    },
  });

  assert.equal(second.report, "durable_packet_hold_reused");
  assert.equal(second.status, "held");
  assert.equal(repeatedProviderCalls, 0);
});
