"use strict";

/**
 * test/full-run-needs-fill-carry.test.js — the middle link of the AI-fill chain.
 *
 * line-adapters/mirrorProspect flags a thin-but-real LeadMiner packet
 * `needs_fill: true` and dispatches it through full-run.dispatchMirrorLane,
 * whose builder (buildMirrorForProspect) reads `prospect.needs_fill` to run the
 * fill instead of refusing. dispatchMirrorLane maps the prospect onto a narrow
 * whitelist before calling the builder, and that whitelist silently DROPPED
 * needs_fill — so every needs_fill packet reached the builder unflagged and was
 * refused as `leadminer_truth_packet_incomplete`. The AI-fill feature was inert
 * in production for exactly this reason. These lock the carry-through.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fullRun = require("../lib/full-run");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "full-run.js"), "utf8");

test("dispatchMirrorLane carries needs_fill onto the object handed to the builder", async () => {
  let seen = null;
  const out = await fullRun.dispatchMirrorLane(
    {
      prospect_id: "p_thin",
      business_name: "Anchor Plumbing Co",
      industry: "plumbing",
      city: "Anchorage",
      state: "AK",
      truth_packet: { source: "leadminer_mirror_ready", mirror_ready: { place_id: "ChIJthin" } },
      truth_packet_source: "leadminer_mirror_ready",
      needs_fill: true,
    },
    {
      dryRun: true,
      buildMirror: async (prospect) => {
        seen = prospect;
        // A dry-run-shaped refusal is fine; this test only cares that the flag
        // arrived. Returning a refusal keeps us out of the reveal path.
        return { ok: false, reason: "stub_build" };
      },
    },
  );

  assert.ok(seen, "the builder was invoked");
  assert.equal(seen.needs_fill, true, "needs_fill reached buildMirrorForProspect — the fill can run");
  // A builder refusal on a leadminer packet routes through as the fail-closed
  // blocked-dispatch shape (so the caller can name the cause), never a throw.
  assert.ok(out && out.fail_closed === true, "a refusal routes through as a fail-closed dispatch");
  assert.ok(Array.isArray(out.blocked) && out.blocked.includes("stub_build"), "the builder's reason is carried out");
});

test("dispatchMirrorLane does NOT invent needs_fill for a packet that was never flagged", async () => {
  let seen = null;
  await fullRun.dispatchMirrorLane(
    {
      prospect_id: "p_strict",
      business_name: "Complete Plumbing",
      industry: "plumbing",
      city: "Anchorage",
      state: "AK",
      truth_packet: { source: "leadminer_mirror_ready", mirror_ready: { place_id: "ChIJstrict" } },
      truth_packet_source: "leadminer_mirror_ready",
      // no needs_fill flag
    },
    {
      dryRun: true,
      buildMirror: async (prospect) => { seen = prospect; return { ok: false, reason: "stub_build" }; },
    },
  );
  assert.ok(seen, "the builder was invoked");
  assert.notEqual(seen.needs_fill, true, "an unflagged packet must not be silently promoted to AI-fill");
});

test("dispatchMirrorLane carries the owner-only sandbox boundary into builder options", async () => {
  let seenOptions = null;
  await fullRun.dispatchMirrorLane(
    {
      prospect_id: "p_sandbox_lane",
      business_name: "Owner Proof Plumbing",
      industry: "plumbing",
      city: "Phoenix",
      state: "AZ",
    },
    {
      dryRun: true,
      lane: "sandbox",
      buildMirror: async (_prospect, options) => {
        seenOptions = options;
        return { ok: false, reason: "stub_build" };
      },
    },
  );
  assert.equal(seenOptions.lane, "sandbox");
});

test("REGRESSION LOCK: the dispatch whitelist names needs_fill", () => {
  // The whole feature was inert because this one field was missing from the
  // object literal dispatchMirrorLane builds. If a future refactor drops it
  // again, this fails before production does.
  const block = src.slice(src.indexOf("async function dispatchMirrorLane"), src.indexOf("dryRun: opts.dryRun === true"));
  assert.match(block, /needs_fill:\s*buildProspect\.needs_fill/, "the whitelist must carry buildProspect.needs_fill through");
});
