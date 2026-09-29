"use strict";

// hero-reel-prebuild-hook.test.js — the opt-in weld between the producer and
// the build lane.
//
// heroReelBlock reads record.media_bank.hero_reel at REQUEST ASSEMBLY
// (mirror-lane-build.js:2650/:3356), never after — so the only moment a reel
// can still make THIS build is before dispatchMirrorLane hands the record to
// buildMirrorForProspect. The hook does exactly that, and these tests pin the
// safety properties that let it ship default-off:
//
//   · OFF is really off: flag unset, the runner is never even consulted;
//   · a refusal (the lambda's honest "ffmpeg_unavailable") leaves the record
//     VERBATIM and the build proceeds on the donor fallback ladder as today;
//   · even a runner that throws cannot cost a build its mirror;
//   · a dry run stays network-free by contract, reel or no reel.

const test = require("node:test");
const assert = require("node:assert/strict");

const { dispatchMirrorLane, heroReelPrebuildEnabled } = require("../lib/full-run");

const FLAG = "GHOST_AGENCY_HERO_REEL_PREBUILD";

const REEL = {
  ok: true,
  url: "https://sb.example.co/storage/v1/object/public/wss-proof-assets/wss-test-acme/hero-reel.mp4",
  composed_from: ["sha-a", "sha-b"],
  generator: "hero_compose_local",
  composed_at: "2026-08-20T12:00:00Z",
  bytes: 480000,
};

const PROSPECT = Object.freeze({
  prospect_id: "wss-test-acme-fencing",
  business_name: "Acme Fencing",
  industry: "fencing",
  record: Object.freeze({
    preview_url: "https://wss-test-acme-fencing.wss-ai.com/",
    existing_field: "must survive",
  }),
});

/** A build stub that captures its input and reports a revealable mirror. */
function buildStub(captured) {
  return async (input) => {
    captured.push(input);
    return { ok: true, revealable: true, preview_url: "https://wss-test-acme-fencing.wss-ai.com/", build_hash: "h1" };
  };
}

function runnerStub(calls, result = REEL) {
  return {
    ensureHeroReel: async (row) => { calls.ensured.push(row); return result; },
    patchHeroReel: async (id, reel) => { calls.patched.push({ id, reel }); return { ok: true }; },
  };
}

async function withFlag(value, fn) {
  const prior = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return await fn();
  } finally {
    if (prior === undefined) delete process.env[FLAG];
    else process.env[FLAG] = prior;
  }
}

test("the flag gate reads the repo's usual truthy spellings", async () => {
  await withFlag(undefined, () => assert.equal(heroReelPrebuildEnabled(), false));
  await withFlag("0", () => assert.equal(heroReelPrebuildEnabled(), false));
  await withFlag("1", () => assert.equal(heroReelPrebuildEnabled(), true));
  await withFlag("true", () => assert.equal(heroReelPrebuildEnabled(), true));
  await withFlag("on", () => assert.equal(heroReelPrebuildEnabled(), true));
});

test("flag OFF: the runner is never consulted and the record passes through verbatim", async () => {
  await withFlag(undefined, async () => {
    const built = [];
    const calls = { ensured: [], patched: [] };
    await dispatchMirrorLane(PROSPECT, { buildMirror: buildStub(built), heroReelRunner: runnerStub(calls) });
    assert.equal(calls.ensured.length, 0, "default-off means the producer does not even load");
    assert.equal(built.length, 1);
    assert.equal(built[0].record, PROSPECT.record, "the very same record object, untouched");
  });
});

test("flag ON: a composed reel reaches THIS build's record and is patched for the next one", async () => {
  await withFlag("1", async () => {
    const built = [];
    const calls = { ensured: [], patched: [] };
    await dispatchMirrorLane(PROSPECT, { buildMirror: buildStub(built), heroReelRunner: runnerStub(calls) });

    assert.equal(calls.ensured.length, 1);
    assert.equal(calls.ensured[0].prospect_id, "wss-test-acme-fencing");

    const rec = built[0].record;
    assert.equal(rec.existing_field, "must survive", "the reel is merged in, never a replacement record");
    assert.equal(rec.media_bank.hero_reel.url, REEL.url);
    assert.deepEqual(rec.media_bank.hero_reel.composed_from, REEL.composed_from);
    assert.equal(rec.media_bank.hero_reel.generator, "hero_compose_local");

    assert.equal(calls.patched.length, 1, "the durable record learns about the reel too");
    assert.equal(calls.patched[0].id, "wss-test-acme-fencing");
  });
});

test("flag ON, ffmpeg absent: the refusal leaves the record verbatim and the build proceeds", async () => {
  await withFlag("1", async () => {
    const built = [];
    const calls = { ensured: [], patched: [] };
    await dispatchMirrorLane(PROSPECT, {
      buildMirror: buildStub(built),
      heroReelRunner: runnerStub(calls, { ok: false, reason: "ffmpeg_unavailable" }),
    });
    assert.equal(built.length, 1, "the build itself is untouched by the reel refusal");
    assert.equal(built[0].record, PROSPECT.record, "no reel, no record change — the donor fallback ladder carries the hero");
    assert.equal(calls.patched.length, 0);
  });
});

test("flag ON, runner throws: nothing may cost a build its mirror", async () => {
  await withFlag("1", async () => {
    const built = [];
    await dispatchMirrorLane(PROSPECT, {
      buildMirror: buildStub(built),
      heroReelRunner: { ensureHeroReel: async () => { throw new Error("boom"); }, patchHeroReel: async () => ({ ok: true }) },
    });
    assert.equal(built.length, 1);
    assert.equal(built[0].record, PROSPECT.record);
  });
});

test("flag ON, reused reel: the in-memory record carries it but no re-patch is spent", async () => {
  await withFlag("1", async () => {
    const built = [];
    const calls = { ensured: [], patched: [] };
    await dispatchMirrorLane(PROSPECT, {
      buildMirror: buildStub(built),
      heroReelRunner: runnerStub(calls, { ...REEL, reused: true }),
    });
    assert.equal(built[0].record.media_bank.hero_reel.url, REEL.url);
    assert.equal(calls.patched.length, 0, "a reel that came FROM the record does not need writing back to it");
  });
});

test("flag ON, dry run: the reel composer would break the zero-network contract, so it never runs", async () => {
  await withFlag("1", async () => {
    const built = [];
    const calls = { ensured: [], patched: [] };
    await dispatchMirrorLane(PROSPECT, { buildMirror: buildStub(built), heroReelRunner: runnerStub(calls), dryRun: true });
    assert.equal(calls.ensured.length, 0);
    assert.equal(built[0].record, PROSPECT.record);
  });
});
