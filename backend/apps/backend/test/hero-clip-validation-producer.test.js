"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const validation = require("../lib/hero-clip-validation");
const { WAN_PRODUCER, ADS_PRODUCER } = require("../lib/hero-video-policy");
const {
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_REMASTER_RECIPE_SHA256,
  WAN_DEFAULT_SETTINGS,
  stableSerialize,
} = require("../lib/wan-hero-policy");
const { createHash } = require("node:crypto");

const SOURCE_SHA = "a".repeat(64);
const OPTIMIZED_SHA = "b".repeat(64);
const CLIP_SHA = "c".repeat(64);
const SOURCE_URL = "https://client.example/work/real-job.jpg";

function fields(promptSha256) {
  return {
    optimized_sha256: OPTIMIZED_SHA,
    optimized_asset_fingerprint: "immutable/source-prep/receipt-1",
    prompt_sha256: promptSha256,
    // Hostile transport labels must never affect durable attribution.
    producer: ADS_PRODUCER,
    generator: ADS_PRODUCER,
    source: "multipart_spoof",
    model_id: "multipart/spoof",
  };
}

function artifact(promptSha256, generationReceipt, generator = generationReceipt?.generator) {
  return {
    raw_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: OPTIMIZED_SHA,
    optimized_asset_fingerprint: "immutable/source-prep/receipt-1",
    prompt_sha256: promptSha256,
    ...(generationReceipt ? { producer: WAN_PRODUCER, generator } : {}),
    ...(generationReceipt ? { generation_receipt: generationReceipt } : {}),
  };
}

function directFields(overrides = {}) {
  return {
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
    prompt_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
    // Hostile transport attribution remains irrelevant to the durable receipt.
    producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    ...overrides,
  };
}

function directArtifact(overrides = {}) {
  return {
    raw_sha256: SOURCE_SHA,
    source_url: SOURCE_URL,
    clip_sha256: CLIP_SHA,
    optimized_sha256: SOURCE_SHA,
    optimized_asset_fingerprint: `direct-source:${SOURCE_SHA}`,
    prompt_sha256: validation.DIRECT_SOURCE_RECIPE_SHA256,
    producer: ADS_PRODUCER,
    generator: "ads_animate_image",
    ...overrides,
  };
}

function wanReceipt(overrides = {}) {
  const modelSettings = { ...WAN_DEFAULT_SETTINGS, seed: 7, numFrames: 81 };
  return {
    schema_version: "wss.hero_generation_receipt.v1",
    producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    source_sha256: SOURCE_SHA,
    raw_sha256: SOURCE_SHA,
    optimized_sha256: OPTIMIZED_SHA,
    master_sha256: "e".repeat(64),
    clip_sha256: CLIP_SHA,
    recipe_sha256: WAN_REMASTER_RECIPE_SHA256,
    model_id: WAN_MODEL_ID,
    model_revision: WAN_MODEL_REVISION,
    model_settings: modelSettings,
    model_settings_sha256: createHash("sha256").update(stableSerialize(modelSettings)).digest("hex"),
    wall_time_ms: 3_600_000,
    generation_time_ms: 3_300_000,
    energy_kwh: 0.24,
    cost_usd: 0.031,
    ...overrides,
  };
}

const expected = {
  sourceSha256: SOURCE_SHA,
  sourceUrl: SOURCE_URL,
  clipSha256: CLIP_SHA,
};

test("WAN validation uses the WAN prep recipe and only durable attribution", () => {
  const receipt = wanReceipt({
    local_path: "C:\\secret\\hero.mp4",
  });
  const durable = artifact(WAN_REMASTER_RECIPE_SHA256, receipt);
  const result = validation.validateDurableRemasterArtifact(
    fields(WAN_REMASTER_RECIPE_SHA256),
    durable,
    { ...expected, producer: WAN_PRODUCER },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.producer, WAN_PRODUCER);
  assert.deepEqual(result.generationReceipt, {
    producer: WAN_PRODUCER,
    generator: WAN_PRODUCER,
    model_id: WAN_MODEL_ID,
    model_revision: WAN_MODEL_REVISION,
    model_settings_sha256: receipt.model_settings_sha256,
    wall_time_ms: 3_600_000,
    generation_time_ms: 3_300_000,
    energy_kwh: 0.24,
    cost_usd: 0.031,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|local_path/i);
});

test("WAN validation rejects the Ads recipe and missing or mismatched model proof", () => {
  const generation = wanReceipt();
  assert.equal(validation.validateDurableRemasterArtifact(
    fields(validation.REMASTER_PROMPT_SHA256),
    artifact(validation.REMASTER_PROMPT_SHA256, generation),
    { ...expected, producer: WAN_PRODUCER },
  ).reason, "durable_remaster_artifact_required");
  assert.equal(validation.validateDurableRemasterArtifact(
    fields(WAN_REMASTER_RECIPE_SHA256),
    { ...artifact(WAN_REMASTER_RECIPE_SHA256), producer: WAN_PRODUCER, generator: WAN_PRODUCER },
    { ...expected, producer: WAN_PRODUCER },
  ).reason, "durable_wan_generation_receipt_required");
  assert.equal(validation.validateDurableRemasterArtifact(
    fields(WAN_REMASTER_RECIPE_SHA256),
    artifact(WAN_REMASTER_RECIPE_SHA256, { ...generation, model_revision: "wrong" }),
    { ...expected, producer: WAN_PRODUCER },
  ).reason, "durable_wan_generation_receipt_required");
});

test("strict technical WAN fallback validates Ads actual generation without relabeling the request", () => {
  const fallback = wanReceipt({
    generator: "ads_animate_image",
    recipe_sha256: validation.REMASTER_PROMPT_SHA256,
    fallback_used: true,
    fallback_from: WAN_PRODUCER,
    fallback_to: ADS_PRODUCER,
    fallback_reason: "local_model_directory_required",
  });
  const result = validation.validateDurableRemasterArtifact(
    fields(validation.REMASTER_PROMPT_SHA256),
    artifact(validation.REMASTER_PROMPT_SHA256, fallback, "ads_animate_image"),
    { ...expected, producer: WAN_PRODUCER },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.producer, WAN_PRODUCER);
  assert.equal(result.generator, "ads_animate_image");
  assert.equal(result.wanFallback, true);
  assert.equal(result.generationReceipt.fallback_reason, "local_model_directory_required");

  const hostile = validation.validateDurableRemasterArtifact(
    fields(validation.REMASTER_PROMPT_SHA256),
    artifact(validation.REMASTER_PROMPT_SHA256, {
      ...fallback,
      fallback_reason: "truth_or_provenance_failure",
    }, "ads_animate_image"),
    { ...expected, producer: WAN_PRODUCER },
  );
  assert.equal(hostile.reason, "durable_wan_fallback_receipt_invalid");
});

test("legacy Ads receipts keep the existing canonical prompt contract", () => {
  const result = validation.validateDurableRemasterArtifact(
    fields(validation.REMASTER_PROMPT_SHA256),
    artifact(validation.REMASTER_PROMPT_SHA256),
    { ...expected, producer: ADS_PRODUCER },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.producer, ADS_PRODUCER);
  assert.equal(result.generationReceipt, undefined);

  const currentAdsArtifact = {
    ...artifact(validation.REMASTER_PROMPT_SHA256),
    producer: ADS_PRODUCER,
    generator: "ads_animate_image",
  };
  const current = validation.validateDurableRemasterArtifact(
    fields(validation.REMASTER_PROMPT_SHA256),
    currentAdsArtifact,
    { ...expected, producer: ADS_PRODUCER },
  );
  assert.equal(current.ok, true, JSON.stringify(current));
  assert.equal(current.generationReceipt, undefined);
});

test("Ads direct-source artifact requires the exact raw SHA fingerprint and canonical recipe", () => {
  assert.equal(validation.DIRECT_SOURCE_RECIPE, "wss.hero.direct_client_photo.v1");
  assert.equal(
    validation.DIRECT_SOURCE_RECIPE_SHA256,
    createHash("sha256").update(validation.DIRECT_SOURCE_RECIPE).digest("hex"),
  );

  const result = validation.validateDurableRemasterArtifact(
    directFields(),
    directArtifact(),
    { ...expected, producer: ADS_PRODUCER },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.rawSha256, SOURCE_SHA);
  assert.equal(result.optimizedSha256, SOURCE_SHA);
  assert.equal(result.sourceUrl, SOURCE_URL);
  assert.equal(result.optimizedAssetFingerprint, `direct-source:${SOURCE_SHA}`);
  assert.equal(result.promptSha256, validation.DIRECT_SOURCE_RECIPE_SHA256);
  assert.equal(result.producer, ADS_PRODUCER);
  assert.equal(result.generator, "ads_animate_image");
});

test("direct-source contract refuses partial, forged, and non-Ads receipts", () => {
  const cases = [
    {
      name: "changed optimized bytes",
      fields: directFields({ optimized_sha256: OPTIMIZED_SHA }),
      artifact: directArtifact({ optimized_sha256: OPTIMIZED_SHA }),
      producer: ADS_PRODUCER,
    },
    {
      name: "fingerprint for another raw SHA",
      fields: directFields({ optimized_asset_fingerprint: `direct-source:${"d".repeat(64)}` }),
      artifact: directArtifact({ optimized_asset_fingerprint: `direct-source:${"d".repeat(64)}` }),
      producer: ADS_PRODUCER,
    },
    {
      name: "remaster recipe relabeled as direct",
      fields: directFields({ prompt_sha256: validation.REMASTER_PROMPT_SHA256 }),
      artifact: directArtifact({ prompt_sha256: validation.REMASTER_PROMPT_SHA256 }),
      producer: ADS_PRODUCER,
    },
    {
      name: "multipart fingerprint differs from durable receipt",
      fields: directFields({ optimized_asset_fingerprint: `direct-source:${"e".repeat(64)}` }),
      artifact: directArtifact(),
      producer: ADS_PRODUCER,
    },
    {
      name: "WAN request claims an Ads direct source",
      fields: directFields(),
      artifact: directArtifact({ producer: WAN_PRODUCER, generator: WAN_PRODUCER }),
      producer: WAN_PRODUCER,
    },
  ];

  for (const fixture of cases) {
    const result = validation.validateDurableRemasterArtifact(
      fixture.fields,
      fixture.artifact,
      { ...expected, producer: fixture.producer },
    );
    assert.equal(result.ok, false, fixture.name);
    assert.equal(result.reason, "durable_remaster_artifact_required", fixture.name);
  }
});

test("invalid durable telemetry is refused instead of silently dropped", () => {
  const result = validation.validateDurableRemasterArtifact(
    fields(WAN_REMASTER_RECIPE_SHA256),
    artifact(WAN_REMASTER_RECIPE_SHA256, wanReceipt({ energy_kwh: -1 })),
    { ...expected, producer: WAN_PRODUCER },
  );
  assert.equal(result.reason, "durable_generation_receipt_invalid");
});
