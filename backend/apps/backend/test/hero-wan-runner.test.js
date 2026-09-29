"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  JOB_SCHEMA_VERSION,
  MAX_BROWSER_BYTES,
  BROWSER_FPS,
  REMASTER_FILTER,
  WAN_REMASTER_RECIPE_SHA256,
  runWanJobFile,
} = require("../scripts/wan-hero/wan-i2v-runner.cjs");

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wss-wan-runner-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.jpg");
  const sourceBytes = Buffer.from("verified-real-scene-source-photo");
  fs.writeFileSync(sourcePath, sourceBytes);
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  const modelPath = path.join(root, "wan-model");
  fs.mkdirSync(modelPath);
  const wanScriptPath = path.join(root, "wan_i2v.py");
  fs.writeFileSync(wanScriptPath, "# fixture only\n");
  const outputDirectory = path.join(root, "outputs");
  const job = {
    prospectId: "prospect-001",
    domain: "example-plumbing.com",
    sourceSha256,
    sourceType: "own_site",
    sourceAssetType: "real_scene",
    sourceImagePath: sourcePath,
    vertical: "plumbing",
    overlaySide: "left",
    modelId: "Wan-AI/Wan2.1-I2V-14B-480P-Diffusers",
    modelRevision: "b184e23a8a16b20f108f727c902e769e873ffc73",
    modelSettings: {
      width: 832,
      height: 480,
      frames: 81,
      steps: 30,
      guidanceScale: 5,
      seed: 20260822,
      cpuOffload: true,
      quantization: "bitsandbytes_nf4_4bit_double_quant_bf16",
    },
    localModelPath: modelPath,
    wanScriptPath,
    outputDirectory,
    estimatedPowerWatts: 500,
    electricityRateUsdPerKwh: 0.2,
    ...overrides,
  };
  const jobPath = path.join(root, "wan-job.json");
  fs.writeFileSync(jobPath, JSON.stringify(job));
  return { root, job, jobPath, outputDirectory, sourcePath, sourceSha256 };
}

function probePayload({ width, height, duration, fps = "0/0", codec = "mjpeg" }) {
  return JSON.stringify({
    streams: [{ width, height, avg_frame_rate: fps, codec_name: codec }],
    format: duration == null ? {} : { duration: String(duration) },
  });
}

function successfulChild(calls, options = {}) {
  return async (command, args, childOptions) => {
    calls.push({ command, args: [...args], options: childOptions });
    const executable = path.basename(command).toLowerCase().replace(/\.exe$/, "");
    const target = args[args.length - 1];
    if (executable === "ffprobe") {
      const name = path.basename(target);
      if (name === "source.jpg") return { code: 0, stdout: probePayload({ width: 1600, height: 900 }) };
      if (name === "optimized-source.jpg") {
        return { code: 0, stdout: probePayload({
          width: options.optimizedWidth || 1600,
          height: options.optimizedHeight || 900,
        }) };
      }
      return { code: 0, stdout: probePayload({ width: 832, height: 480, duration: 5, fps: "16/1", codec: "h264" }) };
    }
    if (executable === "ffmpeg") {
      if (path.basename(target) === "optimized-source.jpg") {
        fs.writeFileSync(target, Buffer.from("deterministic-optimized-still"));
      } else {
        const size = options.browserBytes || 12_000;
        fs.writeFileSync(target, Buffer.alloc(size, 7));
      }
      return { code: 0, stdout: "" };
    }
    if (executable === "python" || executable === "python3") {
      const manifestPath = args[args.indexOf("--manifest") + 1];
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const masterBytes = Buffer.from("wan-master-video");
      fs.writeFileSync(manifest.jobs[0].outputPath, masterBytes);
      const job = manifest.jobs[0];
      const receiptJob = {
        id: job.id,
        prospectId: job.prospectId,
        domain: job.domain,
        generator: "wan2_i2v_local",
        sourceSha256: job.sourceSha256,
        promptSha256: createHash("sha256").update(job.prompt).digest("hex"),
        negativePromptSha256: createHash("sha256").update(job.negativePrompt).digest("hex"),
        outputPath: job.outputPath,
        outputSha256: createHash("sha256").update(masterBytes).digest("hex"),
        seed: job.seed,
        frames: job.numFrames,
        steps: job.numInferenceSteps,
        guidanceScale: job.guidanceScale,
        width: job.width,
        height: job.height,
        fps: job.fps,
        ...(options.receiptJobPatch || {}),
      };
      return {
        code: 0,
        stdout: `WAN_RESULT ${JSON.stringify({
          ok: true,
          generator: "wan2_i2v_local",
          quantization: "bitsandbytes_nf4_4bit_double_quant_bf16",
          modelRevision: manifest.modelRevision,
          jobs: [receiptJob],
          power: { samples: 30, avgPowerWatts: 260, peakPowerWatts: 310, energyKwh: 0.24, peakVramMiB: 15000 },
          ...(options.receiptPatch || {}),
        })}\n`,
      };
    }
    throw new Error(`unexpected child ${command}`);
  };
}

test("dry run validates one local JSON and performs no child calls or writes", async (t) => {
  const item = fixture(t);
  let childCalls = 0;
  const result = await runWanJobFile(item.jobPath, {
    dryRun: true,
    runChild: async () => { childCalls += 1; throw new Error("must not run"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.sourceIdentity.sha256, item.sourceSha256);
  assert.equal(result.plan.networkAllowed, false);
  assert.equal(result.plan.providerCalls, 0);
  assert.equal(childCalls, 0);
  assert.equal(fs.existsSync(item.outputDirectory), false);
});

test("mocked full lane writes strict manifest and machine benchmark JSON", async (t) => {
  const item = fixture(t);
  const calls = [];
  const times = [0, 1_000, 3_599_000, 3_600_000];
  const result = await runWanJobFile(item.jobPath, {
    runChild: successfulChild(calls),
    nowMs: () => times.shift(),
    environment: { PATH: process.env.PATH, PYTHONPATH: "task-vendor", WSS_TEST_SECRET: "must-not-pass" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.schemaVersion, JOB_SCHEMA_VERSION);
  assert.equal(result.sourceIdentity.prospectId, "prospect-001");
  assert.equal(result.sourceIdentity.domain, "example-plumbing.com");
  assert.equal(result.artifacts.raw.sha256, item.sourceSha256);
  assert.equal(result.artifacts.raw.width, 1600);
  assert.equal(result.artifacts.optimized.width, 1600);
  assert.equal(result.artifacts.optimized.promptSha256, WAN_REMASTER_RECIPE_SHA256);
  assert.equal(result.artifacts.optimized.recipeSha256, WAN_REMASTER_RECIPE_SHA256);
  assert.match(WAN_REMASTER_RECIPE_SHA256, /^[a-f0-9]{64}$/);
  assert.equal(result.artifacts.browserVideo.fps, BROWSER_FPS);
  assert.equal(result.artifacts.browserVideo.codec, "h264");
  assert.ok(result.artifacts.browserVideo.bytes <= MAX_BROWSER_BYTES);
  assert.equal(result.metrics.wallTimeMs, 3_600_000);
  assert.equal(result.metrics.energy.estimatedKwh, 0.5);
  assert.deepEqual(result.metrics.energy.gpuTelemetry, {
    samples: 30,
    avgPowerWatts: 260,
    peakPowerWatts: 310,
    energyKwh: 0.24,
    peakVramMiB: 15000,
  });
  assert.equal(result.metrics.estimatedElectricityCostUsd, 0.1);
  assert.deepEqual(result.sideEffects, { providerCalls: 0, fetches: 0, uploads: 0, databaseWrites: 0, emails: 0 });

  assert.deepEqual(calls.map((call) => path.basename(call.command).replace(/\.exe$/, "")), [
    "ffprobe", "ffmpeg", "ffprobe", "python", "ffprobe", "ffmpeg", "ffprobe",
  ]);
  assert.ok(calls.every((call) => call.options.env.WSS_TEST_SECRET == null));
  assert.ok(calls.every((call) => call.options.env.HF_HUB_OFFLINE === "1"));
  assert.ok(calls.every((call) => call.options.env.TRANSFORMERS_OFFLINE === "1"));
  assert.ok(calls.every((call) => call.options.env.PYTHONPATH === "task-vendor"));

  const remasterCall = calls.find((call) => path.basename(call.args[call.args.length - 1]) === "optimized-source.jpg");
  assert.ok(remasterCall.args.includes(REMASTER_FILTER));
  assert.match(REMASTER_FILTER, /min\(iw,1920\)/);
  assert.doesNotMatch(REMASTER_FILTER, /scale=1920/);

  const manifest = JSON.parse(fs.readFileSync(result.artifacts.manifest.path, "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["jobs", "modelPath", "modelRevision"]);
  assert.equal(manifest.modelPath, item.job.localModelPath);
  assert.equal(manifest.modelRevision, item.job.modelRevision);
  assert.equal(manifest.jobs.length, 1);
  assert.deepEqual(Object.keys(manifest.jobs[0]).sort(), [
    "domain", "fps", "guidanceScale", "height", "id", "negativePrompt", "negativePromptSha256",
    "numFrames", "numInferenceSteps", "outputPath", "prompt", "promptSha256", "prospectId",
    "seed", "sourcePath", "sourceSha256", "width",
  ]);
  assert.equal(manifest.jobs[0].prospectId, "prospect-001");
  assert.equal(manifest.jobs[0].domain, "example-plumbing.com");
  assert.equal(manifest.jobs[0].sourcePath, result.artifacts.optimized.path);
  assert.equal(manifest.jobs[0].sourceSha256, result.artifacts.optimized.sha256);
  assert.equal(manifest.jobs[0].outputPath, result.artifacts.masterVideo.path);
  assert.equal(manifest.jobs[0].promptSha256, createHash("sha256").update(manifest.jobs[0].prompt).digest("hex"));
  assert.equal(manifest.jobs[0].negativePromptSha256, createHash("sha256").update(manifest.jobs[0].negativePrompt).digest("hex"));
  assert.equal(path.dirname(manifest.jobs[0].sourcePath), path.dirname(result.artifacts.manifest.path));
  assert.equal(path.dirname(manifest.jobs[0].outputPath), path.dirname(result.artifacts.manifest.path));
  assert.equal(manifest.jobs[0].numFrames, 81);
  assert.equal(manifest.jobs[0].numInferenceSteps, 30);
  assert.equal(manifest.jobs[0].fps, 16);
  assert.match(manifest.jobs[0].prompt, /Keep the LEFT 40% visually calm and uncluttered/);
});

test("source truth and sensitive-source policy fail before any child invocation", async (t) => {
  const cases = [
    [{ sourceSha256: "b".repeat(64) }, "source_sha256_mismatch"],
    [{ sourceAssetType: "logo" }, "source_asset_not_real_scene"],
    [{ sourceType: "stock" }, "source_type_not_allowed"],
    [{ vertical: "fencing", fencingClassification: "sport" }, "vertical_mismatch_sport_fencing"],
    [{ vertical: "med_spa" }, "people_sensitive_vertical_disabled"],
  ];
  for (const [overrides, reason] of cases) {
    const item = fixture(t, overrides);
    let childCalls = 0;
    const result = await runWanJobFile(item.jobPath, {
      runChild: async () => { childCalls += 1; return { code: 0, stdout: "{}" }; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(childCalls, 0);
  }
});

test("Python receipt must exactly match prompt, settings, model revision and quantization", async (t) => {
  const cases = [
    [{ receiptJobPatch: { promptSha256: "0".repeat(64) } }, "prompt hash"],
    [{ receiptJobPatch: { seed: 7 } }, "seed"],
    [{ receiptPatch: { modelRevision: "different-revision" } }, "revision"],
    [{ receiptPatch: { quantization: "different-quantization" } }, "quantization"],
  ];
  for (const [childOptions, label] of cases) {
    const item = fixture(t);
    const result = await runWanJobFile(item.jobPath, {
      runChild: successfulChild([], childOptions),
    });
    assert.deepEqual(result, { ok: false, reason: "wan_result_identity_mismatch" }, label);
  }
});

test("runner refuses a model policy that does not name the Python runtime quantization", async (t) => {
  const item = fixture(t, {
    modelSettings: {
      width: 832,
      height: 480,
      frames: 81,
      steps: 30,
      guidanceScale: 5,
      seed: 20260822,
      quantization: "not-the-runtime-contract",
    },
  });
  const calls = [];
  const result = await runWanJobFile(item.jobPath, { runChild: successfulChild(calls) });
  assert.deepEqual(result, { ok: false, reason: "wan_quantization_required" });
  assert.equal(calls.some((call) => path.basename(call.command).startsWith("python")), false);
});

test("optimized still is refused if its probe shows any upscaling", async (t) => {
  const item = fixture(t);
  const calls = [];
  const result = await runWanJobFile(item.jobPath, {
    runChild: successfulChild(calls, { optimizedWidth: 1601 }),
  });
  assert.deepEqual(result, { ok: false, reason: "optimized_image_upscaled" });
  assert.equal(calls.some((call) => path.basename(call.command).startsWith("python")), false);
});

test("browser derivative retries lower bitrates then refuses anything above 4 MiB", async (t) => {
  const item = fixture(t);
  const calls = [];
  const result = await runWanJobFile(item.jobPath, {
    runChild: successfulChild(calls, { browserBytes: MAX_BROWSER_BYTES + 1 }),
  });
  assert.deepEqual(result, { ok: false, reason: "browser_video_too_large" });
  const browserEncodes = calls.filter((call) => path.basename(call.args[call.args.length - 1]) === "hero-browser.mp4");
  assert.equal(browserEncodes.length, 3);
  const bitrates = browserEncodes.map((call) => call.args[call.args.indexOf("-b:v") + 1]);
  assert.equal(new Set(bitrates).size, 3);
});
