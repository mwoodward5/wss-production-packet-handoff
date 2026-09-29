"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Consent-first full runs still prepare packets concurrently in bounded waves,
// but they never enter the former SiteForge dispatch/autosend path.

const fullRunPath = require.resolve("../lib/full-run");
require(fullRunPath); // warm the module graph once

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function measuredPacketWave(count, { expectedPacketed = count } = {}) {
  const { runFullSystem } = require("../lib/full-run");
  const prospects = Array.from({ length: count }, (_, index) => ({
    prospect_id: `packet_cap_${count}_${index}`,
    business_name: `Packet Cap ${index}`,
    city: "Austin",
    state: "TX",
    industry: "plumbing",
    status: "new",
  }));
  let active = 0;
  let maximum = 0;
  const result = await runFullSystem({
    count,
    prospectIds: prospects.map((prospect) => prospect.prospect_id),
    dryRun: false,
    sandboxMode: true,
    _test: {
      ownerSandboxAddress: () => "owner@wss-test.example",
      select: async () => ({ ok: true, data: prospects }),
      progress: async () => null,
      packetProspectForConsent: async (prospect) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return {
          ok: true,
          prospect_id: prospect.prospect_id,
          business_name: prospect.business_name,
          packeted: true,
          siteforge_dispatched: false,
          autosend_created: false,
          prospect,
        };
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.packeted.length, expectedPacketed);
  return maximum;
}

test("packet loop handles 12 prospects in wave-time with zero build dispatch", async () => {
  const { runFullSystem } = require("../lib/full-run");

  const PER_PACKET_MS = 120;
  const prospects = Array.from({ length: 12 }, (_, i) => ({
    prospect_id: `wave_test_${i}`,
    business_name: `Wave Test ${i}`,
    city: "Austin",
    state: "TX",
    industry: "plumbing",
    status: "new",
  }));
  let buildCalls = 0;
  let activePackets = 0;
  let maxActivePackets = 0;

  const t0 = Date.now();
  const result = await runFullSystem({
    count: 12,
    prospectIds: prospects.map((prospect) => prospect.prospect_id),
    dryRun: false,
    sandboxMode: true,
    _test: {
      ownerSandboxAddress: () => "owner@wss-test.example",
      select: async () => ({ ok: true, data: prospects }),
      progress: async () => null,
      buildPreviewForProspect: async () => {
        buildCalls += 1;
        throw new Error("cold full-run must not dispatch SiteForge");
      },
      packetProspectForConsent: async (prospect) => {
        activePackets += 1;
        maxActivePackets = Math.max(maxActivePackets, activePackets);
        await new Promise((resolve) => setTimeout(resolve, PER_PACKET_MS));
        activePackets -= 1;
        return {
          ok: true,
          prospect_id: prospect.prospect_id,
          business_name: prospect.business_name,
          packeted: true,
          siteforge_dispatched: false,
          autosend_created: false,
          prospect,
        };
      },
    },
  });

  const elapsed = Date.now() - t0;
  assert.equal(result.ok, true);
  assert.equal(result.packeted.length, 12);
  assert.equal(result.built.length, 0);
  assert.equal(buildCalls, 0);
  assert.ok(maxActivePackets > 1, "packet work should be concurrent");
  assert.ok(elapsed < 12 * PER_PACKET_MS, `serial-time floor breached: ${elapsed}ms`);
});

test("packet wave defaults to 25 when neither wave environment variable is set", async () => {
  const priorPacketWave = process.env.GHOST_AGENCY_PACKET_WAVE;
  const priorDispatchWave = process.env.GHOST_AGENCY_DISPATCH_WAVE;
  const priorFullRunMax = process.env.GHOST_AGENCY_FULLRUN_MAX;
  delete process.env.GHOST_AGENCY_PACKET_WAVE;
  delete process.env.GHOST_AGENCY_DISPATCH_WAVE;
  process.env.GHOST_AGENCY_FULLRUN_MAX = "100";
  try {
    assert.equal(await measuredPacketWave(30), 25);
  } finally {
    restoreEnvironment("GHOST_AGENCY_PACKET_WAVE", priorPacketWave);
    restoreEnvironment("GHOST_AGENCY_DISPATCH_WAVE", priorDispatchWave);
    restoreEnvironment("GHOST_AGENCY_FULLRUN_MAX", priorFullRunMax);
  }
});

test("legacy GHOST_AGENCY_DISPATCH_WAVE remains a capped fallback", async () => {
  const priorPacketWave = process.env.GHOST_AGENCY_PACKET_WAVE;
  const priorDispatchWave = process.env.GHOST_AGENCY_DISPATCH_WAVE;
  const priorFullRunMax = process.env.GHOST_AGENCY_FULLRUN_MAX;
  delete process.env.GHOST_AGENCY_PACKET_WAVE;
  process.env.GHOST_AGENCY_FULLRUN_MAX = "100";
  try {
    process.env.GHOST_AGENCY_DISPATCH_WAVE = "3";
    assert.equal(await measuredPacketWave(4), 3);
    process.env.GHOST_AGENCY_DISPATCH_WAVE = "0";
    assert.equal(await measuredPacketWave(4, { expectedPacketed: 0 }), 0);
    process.env.GHOST_AGENCY_DISPATCH_WAVE = "500";
    assert.equal(await measuredPacketWave(51), 50);
  } finally {
    restoreEnvironment("GHOST_AGENCY_PACKET_WAVE", priorPacketWave);
    restoreEnvironment("GHOST_AGENCY_DISPATCH_WAVE", priorDispatchWave);
    restoreEnvironment("GHOST_AGENCY_FULLRUN_MAX", priorFullRunMax);
  }
});

test("GHOST_AGENCY_PACKET_WAVE runs 50 packet writes at once and hard-caps higher values", async () => {
  const priorPacketWave = process.env.GHOST_AGENCY_PACKET_WAVE;
  const priorDispatchWave = process.env.GHOST_AGENCY_DISPATCH_WAVE;
  const priorFullRunMax = process.env.GHOST_AGENCY_FULLRUN_MAX;
  process.env.GHOST_AGENCY_DISPATCH_WAVE = "2";
  process.env.GHOST_AGENCY_FULLRUN_MAX = "100";
  try {
    process.env.GHOST_AGENCY_PACKET_WAVE = "50";
    assert.equal(await measuredPacketWave(51), 50);
    process.env.GHOST_AGENCY_PACKET_WAVE = "500";
    assert.equal(await measuredPacketWave(51), 50);
  } finally {
    restoreEnvironment("GHOST_AGENCY_PACKET_WAVE", priorPacketWave);
    restoreEnvironment("GHOST_AGENCY_DISPATCH_WAVE", priorDispatchWave);
    restoreEnvironment("GHOST_AGENCY_FULLRUN_MAX", priorFullRunMax);
  }
});

test("dry-run plan reports packet work and exactly zero builds/autosends", async () => {
  const { runFullSystem } = require("../lib/full-run");
  const prospects = [
    { prospect_id: "dry_1", business_name: "Dry One", email: "one@example.test", status: "new" },
    { prospect_id: "dry_2", business_name: "Dry Two", email: "two@example.test", status: "new" },
  ];
  const result = await runFullSystem({
    count: 2,
    prospectIds: prospects.map((prospect) => prospect.prospect_id),
    dryRun: true,
    _test: {
      select: async () => ({ ok: true, data: prospects }),
      progress: async () => null,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.wouldPacket, 2);
  assert.equal(result.plan.wouldBuild, 0);
  assert.equal(result.plan.wouldCreateAutosendIntents, 0);
});
