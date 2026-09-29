"use strict";

// THE COUTURE HERO RUNG. Owner, 2026-08-20, looking at seven landscaping
// mirrors sharing one donor fallback clip: "I do not want [it] used for
// everybody... one of a kind couture website." A reel composed from the
// client's OWN banked photographs rides brand.hero_video — with provenance as
// the earning condition, so nothing unproven can ever claim the hero.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { heroReelBlock } = require("../lib/mirror-lane-build");

const REEL = {
  url: "https://sb.example.co/storage/v1/object/public/wss-proof-assets/wss-test-x/hero-reel.mp4",
  generator: "hero_compose_local",
  composed_from: ["sha-a", "sha-b", "sha-c"],
  composed_at: "2026-08-20T09:00:00Z",
};

test("a provenanced composed reel rides brand.hero_video", () => {
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: REEL } }), {
    hero_video: { url: REEL.url, provenance: { kind: "client_derived_reel", generator: "hero_compose_local" } },
  });
  const seedance = {
    ...REEL,
    generator: "openrouter_seedance",
    provenance: {
      kind: "seedance_generated",
      generator: "openrouter_seedance",
      checkpoint_schema: "wss.hero.seedance_provider_checkpoint.v1",
      provider_job_id: "provider_123",
      hero_job_id: "hero_123",
      attempt_id: "hero_attempt:1",
      generation_receipt_schema: "wss.hero.seedance_generation_receipt.v1",
      generation_receipt_sha256: "b".repeat(64),
      output_sha256: "a".repeat(64),
    },
  };
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: seedance } }), { hero_video: { url: REEL.url, provenance: seedance.provenance } });
});

test("provenance is the earning condition — every missing proof refuses the ride", () => {
  assert.deepEqual(heroReelBlock({}), {}, "no bank, no ride");
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: { ...REEL, url: "http://sb.example.co/x.mp4" } } }), {},
    "http never rides");
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: { ...REEL, generator: "mystery_tool" } } }), {},
    "an unrecognized generator earns nothing");
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: { ...REEL, composed_from: [] } } }), {},
    "a reel that cannot name its source photographs is not the client's media");
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: { ...REEL, generator: "openrouter_seedance" } } }), {},
    "a Seedance label with no accepted checkpoint can never masquerade as client media");
  const almostSeedance = {
    ...REEL,
    generator: "openrouter_seedance",
    provenance: {
      kind: "seedance_generated",
      generator: "openrouter_seedance",
      checkpoint_schema: "wss.hero.seedance_provider_checkpoint.v1",
      provider_job_id: "provider_123",
      hero_job_id: "hero_123",
      attempt_id: "hero_attempt:1",
      output_sha256: "a".repeat(64),
    },
  };
  assert.deepEqual(heroReelBlock({ media_bank: { hero_reel: almostSeedance } }), {},
    "an accepted checkpoint without durable generation-receipt proof is still not Seedance provenance");
});

test("both engine-request lanes merge the proven hero rung", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-lane-build.js"), "utf8");
  assert.equal(
    (source.match(/\.\.\.heroReelBlock\(prospect\.record \|\| \{\}\),/g) || []).length,
    2,
    "both the direct and resolver request lanes must merge the proven hero reel",
  );
});
