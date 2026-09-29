"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  POLICY_VERSION,
  PROMPT_PACK_ARCHIVE_SHA256,
  buildWanHeroPolicy,
} = require("../lib/wan-hero-policy");

const BASE = Object.freeze({
  prospectId: "prospect-001",
  domain: "example-plumbing.com",
  sourceSha256: "a".repeat(64),
  sourceType: "own_site",
  sourceAssetType: "real_scene",
  vertical: "plumbing",
  overlaySide: "left",
  modelId: "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers",
  modelRevision: "0123456789abcdef",
  modelSettings: {
    width: 832,
    height: 480,
    frames: 81,
    steps: 30,
    guidanceScale: 5,
    seed: 20260822,
    cpuOffload: true,
  },
});

test("renders the versioned prompt pack with the safe 5-second default", () => {
  const result = buildWanHeroPolicy(BASE);
  assert.equal(result.ok, true);
  assert.equal(result.policyVersion, POLICY_VERSION);
  assert.equal(result.promptPackArchiveSha256, PROMPT_PACK_ARCHIVE_SHA256);
  assert.equal(result.preset, "cheap_5s");
  assert.equal(result.durationSeconds, 5);
  assert.match(result.prompt, /Create a 5-second photorealistic cinematic website hero shot/);
  assert.match(result.prompt, /Keep the LEFT 40% visually calm and uncluttered/);
  assert.doesNotMatch(result.prompt, /\{[A-Z_]+\}/);
  assert.match(result.negativePrompt, /changing identity/);
  assert.match(result.negativePrompt, /changed logo/);
});

test("cache key is deterministic across model-setting key order", () => {
  const first = buildWanHeroPolicy(BASE);
  const second = buildWanHeroPolicy({
    ...BASE,
    modelSettings: {
      seed: 20260822,
      cpuOffload: true,
      steps: 30,
      guidanceScale: 5,
      frames: 81,
      height: 480,
      width: 832,
    },
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.cacheKey, second.cacheKey);
  assert.deepEqual(first.model.settings, second.model.settings);
});

test("cache cannot be reused across prospects or prospect domains", () => {
  const original = buildWanHeroPolicy(BASE);
  const otherProspect = buildWanHeroPolicy({ ...BASE, prospectId: "prospect-002" });
  const otherDomain = buildWanHeroPolicy({ ...BASE, domain: "other-plumbing.com" });
  assert.equal(original.ok, true);
  assert.notEqual(original.cacheKey, otherProspect.cacheKey);
  assert.notEqual(original.cacheKey, otherDomain.cacheKey);
});

test("only identity-bound real scenes from the own site or GBP are accepted", () => {
  assert.deepEqual(
    buildWanHeroPolicy({ ...BASE, sourceSha256: "" }),
    { ok: false, reason: "source_sha256_required" },
  );
  assert.deepEqual(
    buildWanHeroPolicy({ ...BASE, sourceAssetType: "logo" }),
    { ok: false, reason: "source_asset_not_real_scene" },
  );
  assert.deepEqual(
    buildWanHeroPolicy({ ...BASE, sourceAssetType: "stock" }),
    { ok: false, reason: "source_asset_not_real_scene" },
  );
  assert.deepEqual(
    buildWanHeroPolicy({ ...BASE, sourceType: "stock" }),
    { ok: false, reason: "source_type_not_allowed" },
  );
  assert.equal(buildWanHeroPolicy({ ...BASE, sourceType: "gbp" }).ok, true);
});

test("fencing must be explicitly classified as contracting and sport evidence still refuses", () => {
  const fence = { ...BASE, vertical: "fencing" };
  assert.deepEqual(
    buildWanHeroPolicy(fence),
    { ok: false, reason: "fencing_contracting_required" },
  );
  assert.deepEqual(
    buildWanHeroPolicy({ ...fence, fencingClassification: "sport" }),
    { ok: false, reason: "vertical_mismatch_sport_fencing" },
  );
  const contradicted = buildWanHeroPolicy({
    ...fence,
    fencingClassification: "contracting",
    businessName: "Duke City Fencing Club",
    gbpCategory: "Fencing school",
    siteText: "Olympic sword coaches and classes",
  });
  assert.equal(contradicted.ok, false);
  assert.equal(contradicted.reason, "vertical_mismatch_sport_fencing");
  assert.match(contradicted.detail, /club/);
  assert.equal(buildWanHeroPolicy({
    ...fence,
    fencingClassification: "contracting",
    businessName: "Alamo Fence Company",
  }).ok, true);
});

test("people-sensitive verticals are disabled by default and require verified consent when enabled", () => {
  const sensitive = { ...BASE, vertical: "med spa" };
  assert.deepEqual(
    buildWanHeroPolicy(sensitive),
    { ok: false, reason: "people_sensitive_vertical_disabled" },
  );
  assert.deepEqual(
    buildWanHeroPolicy({ ...sensitive, allowPeopleSensitive: true }),
    { ok: false, reason: "people_consent_required" },
  );
  const allowed = buildWanHeroPolicy({
    ...sensitive,
    allowPeopleSensitive: true,
    peopleConsentVerified: true,
    preset: "premium_10s",
    durationSeconds: 10,
    overlaySide: "right",
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.durationSeconds, 10);
  assert.match(allowed.prompt, /Keep the RIGHT 40% visually calm and uncluttered/);
});

test("recognizable people require consent even in a contractor vertical", () => {
  assert.deepEqual(
    buildWanHeroPolicy({ ...BASE, containsRecognizablePeople: true }),
    { ok: false, reason: "people_consent_required" },
  );
  assert.equal(buildWanHeroPolicy({
    ...BASE,
    containsRecognizablePeople: true,
    peopleConsentVerified: true,
  }).ok, true);
});

test("allowlist, overlay, duration, revision and settings fail closed", () => {
  assert.equal(buildWanHeroPolicy({ ...BASE, vertical: "sword school" }).reason, "vertical_not_allowed");
  assert.equal(buildWanHeroPolicy({ ...BASE, overlaySide: "center" }).reason, "overlay_side_not_allowed");
  assert.equal(buildWanHeroPolicy({ ...BASE, preset: "cheap_5s", durationSeconds: 10 }).reason, "duration_preset_mismatch");
  assert.equal(buildWanHeroPolicy({ ...BASE, modelRevision: "" }).reason, "model_revision_required");
  assert.equal(buildWanHeroPolicy({ ...BASE, modelSettings: {} }).reason, "model_settings_required");
});
