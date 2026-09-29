"use strict";

/**
 * test/line-store-read-retry.test.js — the 2026-08-31 fleet kill classes,
 * lane C.
 *
 * 1. `prospect_store_read_failed: rows_0` — the mirror dispatch read the
 *    prospect store ~3-4s after this same pipeline had awaited the write that
 *    qualification persists, and seven qualified rows died on the miss while
 *    the 2026-08-20 incident measured the identical row answering a direct
 *    re-read (200, 111KB, 0.24s). One empty read is not proof of absence: the
 *    read now retries, briefly and bounded, before the terminal rejection.
 * 2. `mirror_dispatch_failed_before_build` — three of four fleet kills were
 *    content_floor gate refusals (correct fail-closed lead verdicts) and one
 *    lost its diagnostics on the pre-#511 deploy. Pin the contract that the
 *    surviving verdict reaches the row whether or not the refusal side
 *    channel fired.
 * 3. `build_retry_exhausted` — the budget is 7 (was 5) so a single ~30-minute
 *    transient outage no longer burns every attempt.
 */

const test = require("node:test");
const assert = require("node:assert");

const { mirrorProspect } = require("../lib/line-adapters");
const { MAX_BUILD_RETRY_ATTEMPTS } = require("../lib/line-continuation");

function thinPacket() {
  return {
    source: "leadminer_mirror_ready",
    meta: { source: "leadminer_mirror_ready", build_ready: false, missing_build_evidence: ["services"] },
    mirror_ready: { business_name: "Anchor Plumbing Co", place_id: "ChIJthin", industry: "plumbing" },
    services: ["Drain Cleaning", "Water Heater Repair"],
    industry: "plumbing",
  };
}

function thinRow(id) {
  return {
    prospect_id: id,
    business_name: "Anchor Plumbing Co",
    city: "Anchorage",
    state: "AK",
    email: "owner@anchorplumbing.example",
    status: "held",
    preview_url: "",
    updated_at: "2026-08-14T08:00:00.000Z",
    record: {
      status: "held",
      handoff_state: "ready_for_build",
      build_ready: false,
      truth_packet: thinPacket(),
      truth_packet_source: "leadminer_mirror_ready",
      business_name: "Anchor Plumbing Co",
      industry: "plumbing",
    },
  };
}

const DISPATCH_OK = async () => ({ mode: "mirror_lane", urls: { preview_url: "https://wss-test-anchor.wss-ai.com/" } });

test("a rows_0 store read retries and finds the prospect the pipeline just persisted", async () => {
  let reads = 0;
  let dispatched = false;
  const out = await mirrorProspect(
    { prospectId: "place_thin", needs_fill: true },
    {
      lane: "sandbox",
      select: async () => {
        reads += 1;
        return reads === 1
          ? { ok: true, data: [] } // the miss: row committed, not yet visible
          : { ok: true, data: [thinRow("place_thin")] };
      },
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async () => { dispatched = true; return DISPATCH_OK(); },
    },
  );
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(reads, 2, "the second read saw the persisted prospect");
  assert.equal(dispatched, true, "a transient miss must not kill a qualified row");
});

test("a permanently missing prospect still fails terminally after the bounded retries", async () => {
  let reads = 0;
  let dispatched = false;
  const out = await mirrorProspect(
    { prospectId: "place_gone", needs_fill: true },
    {
      lane: "sandbox",
      select: async () => {
        reads += 1;
        return { ok: true, data: [] };
      },
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async () => { dispatched = true; return DISPATCH_OK(); },
    },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, "prospect_store_read_failed: rows_0");
  assert.equal(out.terminal, "rejected");
  assert.equal(reads, 3, "exactly three attempts — no hot loop");
  assert.equal(dispatched, false, "no dispatch without a persisted prospect");
});

test("a not-configured (dry-run) store answer does not burn retries", async () => {
  let reads = 0;
  const out = await mirrorProspect(
    { prospectId: "place_thin", needs_fill: true },
    {
      lane: "sandbox",
      select: async () => {
        reads += 1;
        return { ok: false, skipped: "supabase_not_configured", data: [] };
      },
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: DISPATCH_OK,
    },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, "prospect_store_read_failed: supabase_not_configured");
  assert.equal(reads, 1, "a visibility race is not the failure; retrying cannot help");
});

test("an expired deadline stops the retry loop after the first miss", async () => {
  let reads = 0;
  const out = await mirrorProspect(
    { prospectId: "place_thin", needs_fill: true },
    {
      lane: "sandbox",
      deadlineAt: Date.now() - 1000,
      select: async () => {
        reads += 1;
        return { ok: true, data: [] };
      },
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: DISPATCH_OK,
    },
  );
  assert.equal(out.ok, false);
  assert.equal(out.reason, "prospect_store_read_failed: rows_0");
  assert.equal(reads, 1, "deadline exceeded — no second read");
});

test("a content_floor refusal keeps its gate, verdict and lead-quality cause on the row", async () => {
  const out = await mirrorProspect(
    { prospectId: "place_thin", needs_fill: true },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [thinRow("place_thin")] }),
      mirrorLaneEnabled: () => true,
      dispatchMirrorLane: async (prospect, opts) => {
        if (opts && typeof opts.onRefusal === "function") {
          opts.onRefusal({
            reason: "not_revealable",
            detail: ["content_floor=failed"],
            cause: { content_floor: "no verified content of the client's own resolved from any source" },
          });
        }
        return {
          mode: "mirror_lane",
          pending: false,
          fail_closed: true,
          blocked: ["mirror_engine_not_revealable"],
          urls: {},
          buildStatus: { ready: false, blocked: ["mirror_engine_not_revealable"], detail: ["content_floor=failed"] },
        };
      },
    },
  );
  assert.equal(out.ok, false);
  assert.match(String(out.reason || ""), /mirror_dispatch_failed_before_build/);
  assert.equal(out.dispatchFailure.beforeBuild, true, "no revealable build identity existed");
  assert.equal(out.dispatchFailure.code, "not_revealable");
  assert.equal(out.dispatchFailure.detail, "content_floor=failed");
  assert.match(String(out.dispatchFailure.reason || ""), /content_floor/, "the gate name rides the failure reason");
  assert.match(String(out.dispatchFailure.reason || ""), /no verified content/, "what the gate SAW rides too");
});

test("the refusal side channel lost, the blocked shape alone still names the failing gate", async () => {
  const out = await mirrorProspect(
    { prospectId: "place_thin", needs_fill: true },
    {
      lane: "sandbox",
      select: async () => ({ ok: true, data: [thinRow("place_thin")] }),
      mirrorLaneEnabled: () => true,
      // No onRefusal call — the exact pre-#511 gap that left one fleet kill
      // with no cause and no detail. The blocked dispatch shape must carry
      // the diagnosis on its own.
      dispatchMirrorLane: async () => ({
        mode: "mirror_lane",
        pending: false,
        fail_closed: true,
        blocked: ["mirror_engine_not_revealable"],
        urls: {},
        buildStatus: { ready: false, blocked: ["mirror_engine_not_revealable"], detail: ["content_floor=failed"] },
      }),
    },
  );
  assert.equal(out.ok, false);
  assert.match(String(out.reason || ""), /content_floor=failed/, "the failing gate is in the row's reason");
  assert.equal(out.dispatchFailure.code, "mirror_engine_not_revealable", "cause falls back to the blocked name");
  assert.equal(out.dispatchFailure.detail, "content_floor=failed", "detail falls back to the blocked detail");
  assert.equal(out.dispatchFailure.beforeBuild, true);
});

test("the build retry budget outlives a ~30 minute transient outage", () => {
  assert.equal(MAX_BUILD_RETRY_ATTEMPTS, 7, "5 attempts all burned inside one 2026-08-31 outage window");
});
