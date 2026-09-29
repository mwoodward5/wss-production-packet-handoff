"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { finalizeHeroArtifact } = require("../lib/mirror-engine/engine");

const manifest = {
  hero_video: {
    client_video_path: "assets/hero-client-fencing.mp4",
    wss_fallback_clip_path: "assets/hero-fallback-fencing.mp4",
  },
};

function ladder(files) {
  const raw = JSON.parse(files["index.html"].toString("utf8").match(/<script[^>]+hero-video-ladder[^>]*>([\s\S]*?)<\/script>/i)[1]);
  return raw.sources;
}

test("an absent client clip is never advertised before the immutable fallback", () => {
  const files = {
    "index.html": Buffer.from('<script id="hero-video-ladder" type="application/json">{"sources":["assets/hero-client-fencing.mp4","assets/hero-fallback-fencing.mp4"]}</script>'),
    "assets/hero-fallback-fencing.mp4": Buffer.from("fallback"),
  };
  const out = finalizeHeroArtifact({ files, manifest, heroVideoSlot: manifest.hero_video.client_video_path, heroVideoPlaced: 0 });
  assert.equal(out.status, "passed");
  assert.equal(out.provenance, "wss_static_fallback");
  assert.deepEqual(ladder(files), ["assets/hero-fallback-fencing.mp4"]);
});

test("verified client bytes retain a real fallback rung and truthful provenance", () => {
  const files = {
    "index.html": Buffer.from('<script id="hero-video-ladder" type="application/json">{"sources":["assets/hero-client-fencing.mp4","assets/hero-fallback-fencing.mp4"]}</script>'),
    "assets/hero-client-fencing.mp4": Buffer.from("client"),
    "assets/hero-fallback-fencing.mp4": Buffer.from("fallback"),
  };
  const out = finalizeHeroArtifact({ files, manifest, heroVideoSlot: manifest.hero_video.client_video_path, heroVideoPlaced: 1 });
  assert.equal(out.provenance, "verified_client_media");
  assert.deepEqual(ladder(files), ["assets/hero-client-fencing.mp4", "assets/hero-fallback-fencing.mp4"]);
});

test("a declared ladder with no immutable media fails before release", () => {
  const files = { "index.html": Buffer.from('<script id="hero-video-ladder" type="application/json">{"sources":[]}</script>') };
  const out = finalizeHeroArtifact({ files, manifest, heroVideoSlot: manifest.hero_video.client_video_path, heroVideoPlaced: 0 });
  assert.equal(out.status, "failed");
  assert.equal(out.provenance, null);
  assert.deepEqual(ladder(files), []);
});

test("Seedance is named only when its accepted checkpoint, attempt, and output hash agree", () => {
  const files = {
    "index.html": Buffer.from('<script id="hero-video-ladder" type="application/json">{"sources":[]}</script>'),
    "assets/hero-client-fencing.mp4": Buffer.from("provider-bytes"),
    "assets/hero-fallback-fencing.mp4": Buffer.from("fallback"),
  };
  const outputSha = createHash("sha256").update(files["assets/hero-client-fencing.mp4"]).digest("hex");
  const proof = {
    kind: "seedance_generated",
    checkpoint_schema: "wss.hero.seedance_provider_checkpoint.v1",
    provider_job_id: "provider_1",
    hero_job_id: "hero_1",
    attempt_id: "hero_attempt:1",
    output_sha256: outputSha,
  };
  const out = finalizeHeroArtifact({ files, manifest, heroVideoSlot: manifest.hero_video.client_video_path, heroVideoPlaced: 1, heroVideoProvenance: proof });
  assert.equal(out.status, "passed");
  assert.equal(out.provenance, "seedance_generated");
  const bad = finalizeHeroArtifact({
    files: {
      "index.html": Buffer.from('<script id="hero-video-ladder" type="application/json">{"sources":[]}</script>'),
      "assets/hero-client-fencing.mp4": Buffer.from("provider-bytes"),
      "assets/hero-fallback-fencing.mp4": Buffer.from("fallback"),
    },
    manifest,
    heroVideoSlot: manifest.hero_video.client_video_path,
    heroVideoPlaced: 1,
    heroVideoProvenance: { ...proof, provider_job_id: "" },
  });
  assert.equal(bad.status, "failed");
  assert.equal(bad.provenance, null);
});
