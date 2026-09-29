"use strict";

// test/duplicate-prospect-guard.test.js
//
// The harvester wrote RiverCity Plumbing as TWO rows (two place_ids, one
// phone). Both satisfied every condition the LeadMiner picker checks, so the
// second one was queued to build its own mirror and send its own "here's your
// new website" email to a business that had already received one. Riley's
// resolver was fixed to READ them as one client; this stops the line from
// PITCHING them as two.
//
// The marked row is skipped, never deleted — a duplicate is still evidence of
// what the harvester did.

const test = require("node:test");
const assert = require("node:assert");
const { pickProspects } = require("../lib/line-adapters");

function packetRow(prospectId, extraRecord = {}) {
  return {
    prospect_id: prospectId,
    business_name: "RiverCity Plumbing",
    city: "Jacksonville",
    state: "FL",
    email: "office@rivercityplumbingjax.com",
    status: "held",
    preview_url: "",
    record: {
      handoff_state: "ready_for_build",
      build_ready: true,
      truth_packet_source: "leadminer_mirror_ready",
      truth_packet: {
        mirror_ready: {
          business_name: "RiverCity Plumbing",
          industry: "plumbing",
          services: ["Drain cleaning", "Water heater repair"],
          logo_url: "https://rivercityplumbingjax.com/logo.png",
        },
      },
      industry: "plumbing",
      ...extraRecord,
    },
  };
}

test("a row marked as a duplicate is never picked for a build", async () => {
  const rows = [
    packetRow("place_keep"),
    packetRow("place_dupe", {
      duplicate_of: { prospect_id: "place_keep", reason: "same business harvested twice" },
    }),
  ];
  const picked = await pickProspects(
    { count: 10, target: "leadminer" },
    // The shelf is read server-side filtered through `select` now — the
    // freshest-N `selectRows` window hid every packet but the newest one.
    { select: async () => ({ ok: true, data: rows }) },
  );
  const ids = picked.map((p) => p.prospectId);
  assert.ok(ids.includes("place_keep"), "the surviving row must still be pickable");
  assert.ok(!ids.includes("place_dupe"), "the duplicate must not be pitched a second time");
});
