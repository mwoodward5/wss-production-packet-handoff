"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const lineState = require("../lib/line-state");
const { processRowPhase } = require("../lib/line-runner");

const NOW = "2026-08-28T21:00:00.000Z";
const BATCH_ID = "line_prejob_fallback";
const ROW_ID = `${BATCH_ID}:0`;
const BUILD_HASH = "e".repeat(64);
const PREVIEW = "https://prejob-fallback.wss-ai.com/";
const SOURCE = "https://prejob-fallback.example.com/";

function mirroredRow(heroOverrides = {}) {
  let row = lineState.newRow({
    prospectId: "prejob-fallback-1",
    businessName: "Prejob Fallback Fence",
    city: "Memphis",
    state: "TN",
    vertical: "fencing",
    email: "owner@example.test",
    now: NOW,
  });
  row = lineState.advanceRow(row, "qualified", { now: NOW }).row;
  row = lineState.advanceRow(row, "mirrored", { previewUrl: PREVIEW, now: NOW }).row;
  return {
    ...row,
    rowId: ROW_ID,
    batchId: BATCH_ID,
    buildHash: BUILD_HASH,
    currentWebsite: SOURCE,
    heroRemaster: {
      required: false,
      ready: true,
      pending: false,
      hold: false,
      fallback: true,
      applied: false,
      status: "skipped",
      reason: "no_verified_owned_photo",
      buildHash: BUILD_HASH,
      ...heroOverrides,
    },
  };
}

function deps(counters) {
  return {
    env: { GHOST_AGENCY_HERO_AUTOLINE: "1" },
    sourceFacts: async () => ({}),
    gate: async () => {
      counters.gates += 1;
      return {
        pass: true,
        failed: [],
        checks: [],
        capture: {
          ok: true,
          shots: {
            build_hash: BUILD_HASH,
            old_captured_url: SOURCE,
            old_shot_sha: "d".repeat(64),
            new_captured_url: PREVIEW,
            new_shot_sha: "f".repeat(64),
          },
          results: [],
        },
      };
    },
    writePreviewUrl: async () => ({ ok: true }),
    queueEmail: async () => ({ ok: true }),
    recordEvent: async () => ({ ok: true }),
    now: () => NOW,
  };
}

test("definitive enqueue-time no-photo refusal crosses the donor fallback boundary", async () => {
  const counters = { gates: 0 };
  const out = await processRowPhase(
    mirroredRow(),
    { batchId: BATCH_ID, lane: "sandbox" },
    deps(counters),
  );
  assert.equal(out.row.status, "gate_passed", JSON.stringify(out));
  assert.equal(counters.gates, 1);
});

test("the same reason cannot bypass the boundary after a hero job exists", async () => {
  const counters = { gates: 0 };
  const out = await processRowPhase(
    mirroredRow({ jobId: "hrj_already_created", producer: "openrouter_seedance" }),
    { batchId: BATCH_ID, lane: "sandbox" },
    deps(counters),
  );
  assert.equal(out.row.status, "rejected", JSON.stringify(out));
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(counters.gates, 0);
});

test("an attempted provider identity also remains fail-closed without a job id", async () => {
  const counters = { gates: 0 };
  const out = await processRowPhase(
    mirroredRow({ attemptId: "hero_attempt:1" }),
    { batchId: BATCH_ID, lane: "sandbox" },
    deps(counters),
  );
  assert.equal(out.row.status, "rejected", JSON.stringify(out));
  assert.equal(out.row.reason, "hero_media_requires_fresh_mirror");
  assert.equal(counters.gates, 0);
});
