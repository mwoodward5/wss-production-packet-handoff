"use strict";

// Finding 2 (the 121-count largest pre-build rejection): a LeadMiner export can
// drop the industry LABEL while still carrying the client's own service list.
// The pick-side admission required a label string, so such packets were killed
// as build_ready_contract_incomplete though the builder derives the trade from
// services. Admission now uses inferTrade on the empty-label case.
const test = require("node:test");
const assert = require("node:assert/strict");

const pick = require("../lib/line-production-pick");

// A real LeadMiner needs_fill packet: strong service evidence, NO industry label.
function servicesOnlyRow() {
  return {
    business_name: "Pacific Concrete Co",
    city: "Tempe",
    state: "AZ",
    record: {
      truth_packet_source: "leadminer_mirror_ready",
      build_ready: false,
      truth_packet: {
        mirror_ready: {
          business_name: "Pacific Concrete Co",
          city: "Tempe",
          state: "AZ",
          industry: "", // <- the dropped label
          services: ["Concrete driveways", "Concrete slab pouring", "Foundation concrete work"],
        },
      },
    },
  };
}

test("services-only packet (empty label) is now a recoverable pick", () => {
  const row = servicesOnlyRow();
  // Guard: the label really is empty, so this exercises the inferTrade path.
  assert.equal(String(row.record.truth_packet.mirror_ready.industry || ""), "");
  assert.equal(pick.recoverablePacket(row), true, "confident services must satisfy the vertical requirement");
});

test("a packet with neither label nor recognizable services stays rejected", () => {
  const row = servicesOnlyRow();
  // Neutral name + non-trade services => no confident inference => not admitted.
  row.business_name = "Downtown Ventures LLC";
  row.record.truth_packet.mirror_ready.business_name = "Downtown Ventures LLC";
  row.record.truth_packet.mirror_ready.services = ["Open Mon-Fri", "Free consultation"];
  assert.equal(pick.recoverablePacket(row), false, "no trade evidence must not be admitted");
});
