"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProductionPick, recoverablePacket } = require("../lib/line-production-pick");

function thinLeadMinerRow(id = "place_thin") {
  return {
    prospect_id: id,
    business_name: "Pacific Plumbing Co",
    city: "Honolulu",
    state: "HI",
    industry: "plumbing",
    record: {
      source: "leadminer_mirror_ready",
      truth_packet_source: "leadminer_mirror_ready",
      build_ready: false,
      handoff_state: "held_incomplete",
      industry: "plumbing",
      truth_packet: {
        source: "leadminer_mirror_ready",
        mirror_ready: {
          business_name: "Pacific Plumbing Co",
          city: "Honolulu",
          state: "HI",
          industry: "plumber",
          place_id: "ChIJthin",
        },
      },
    },
  };
}

test("production All-Trades pickup restores existing needs_fill semantics for canonical thin LeadMiner packets", async () => {
  const base = [{
    prospectId: "place_thin",
    businessName: "Pacific Plumbing Co",
    city: "Honolulu",
    state: "HI",
    vertical: "plumbing",
    contractIssue: "build_ready_contract_incomplete:proof,qualification,brand_evidence,mirror_request",
    leadminerQualified: false,
  }];
  base.funnel = [{ stage: "mine", entered: 1, survived: 1, rejected: {} }];
  const pick = createProductionPick({
    pick: async () => base,
    select: async () => ({ ok: true, data: [thinLeadMinerRow()] }),
  });
  const out = await pick({ target: "plumbing in Honolulu HI", count: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].contractIssue, "");
  assert.equal(out[0].leadminerQualified, true);
  assert.equal(out[0].needs_fill, true);
  assert.deepEqual(out.funnel, base.funnel, "diagnostic funnel must survive the wrapper");
});

test("ordinary incomplete mined records remain fail-closed", async () => {
  const base = [{
    prospectId: "plain",
    businessName: "Plain Co",
    contractIssue: "build_ready_contract_incomplete:proof,qualification,brand_evidence,mirror_request",
  }];
  const pick = createProductionPick({
    pick: async () => base,
    select: async () => ({ ok: true, data: [{
      prospect_id: "plain",
      business_name: "Plain Co",
      city: "Austin",
      state: "TX",
      industry: "plumbing",
      record: { build_ready: false },
    }] }),
  });
  const out = await pick({ target: "plumbing in Austin TX", count: 1 });
  assert.match(out[0].contractIssue, /^build_ready_contract_incomplete:/);
  assert.notEqual(out[0].leadminerQualified, true);
  assert.notEqual(out[0].needs_fill, true);
});

test("LeadMiner source without a real place/trade identity is still not recoverable", () => {
  const row = thinLeadMinerRow("empty");
  row.business_name = "";
  row.city = "";
  row.state = "";
  row.industry = "";
  row.record.industry = "";
  row.record.truth_packet.mirror_ready = { place_id: "ChIJempty" };
  assert.equal(recoverablePacket(row), false);
});
