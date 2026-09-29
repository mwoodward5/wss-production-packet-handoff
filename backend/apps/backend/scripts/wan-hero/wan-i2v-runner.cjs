"use strict";

const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildWanHeroPolicy,
  stableSerialize,
  WAN_MODEL_ID,
  WAN_MODEL_REVISION,
  WAN_DEFAULT_SETTINGS,
  WAN_REMASTER_RECIPE_SHA256,
} = require("../../lib/wan-hero-policy");

const JOB_SCHEMA_VERSION = "wss.wan_i2v_runner_result.v1";
const MAX_JOB_BYTES = 64 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_MASTER_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BROWSER_BYTES = 4 * 1024 * 1024;
const BROWSER_FPS = 16;
const ALLOWED_WAN_FRAMES = new Set([17, 33, 49, 65, 81, 161]);
const WAN_QUANTIZATION = WAN_DEFAULT_SETTINGS.quantization;
const CHILD_OUTPUT_LIMIT = 2 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const GENERATED_NAMES = new Set([
  "optimized-source.jpg",
  "wan-manifest.json",
  "wan-master.mp4",
  "hero-browser.mp4",
]);
const REMASTER_FILTER = [
  "scale=w='min(iw,1920)':h=-2:flags=lanczos",
  "hqdn3d=0.8:0.8:1.5:1.5",
  "unsharp=5:5:0.25:5:5:0.0",
  "eq=contrast=1.01:saturation=1.02:gamma=1.0",
  "format=yuvj420p",
].join(",");
const BROWSER_FILTER = `fps=${BROWSER_FPS},scale=w='min(iw,1920)':h=-2:flags=lanczos,format=yuv420p`;

class WanRunnerError extends Error {
  constructor(reason, detail = "") {
    super(reason);
    this.name = "WanRunnerError";
    this.reason = reason;
    this.detail = detail ? String(detail).slice(0, 160) : "";
  }
}

function fail(reason, detail = "") {
  throw new WanRunnerError(reason, detail);
}

function failureResult(error) {
  const reason = error instanceof WanRunnerError ? error.reason : "wan_runner_failed";
  const detail = error instanceof WanRunnerError ? error.detail : "";
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function finiteNumber(value, { min, max, reason }) {
  if (value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim())) fail(reason);
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) fail(reason);
  return number;
}

function localPath(baseDirectory, value, reason) {
  const raw = String(value || "").trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw) || /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) fail(reason);
  const resolved = path.resolve(baseDirectory, raw);
  if (/^\\\\/.test(resolved)) fail(reason);
  return resolved;
}

function existingFile(filePath, reason) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    fail(reason);
  }
  if (!stat.isFile()) fail(reason);
  return stat;
}

function existingDirectory(directoryPath, reason) {
  try {
    if (!fs.statSync(directoryPath).isDirectory()) fail(reason);
  } catch {
    fail(reason);
  }
  return directoryPath;
}

function executable(baseDirectory, value, allowedNames, fallback, reason) {
  const raw = String(value || fallback).trim();
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) fail(reason);
  const basename = path.basename(raw).toLowerCase();
  if (!allowedNames.includes(basename)) fail(reason);
  if (raw.includes("/") || raw.includes("\\") || path.isAbsolute(raw)) {
    const resolved = localPath(baseDirectory, raw, reason);
    existingFile(resolved, reason);
    return resolved;
  }
  return raw;
}

function readJob(jobFilePath) {
  const rawPath = String(jobFilePath || "").trim();
  if (!rawPath || /^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) fail("local_job_json_required");
  const resolved = path.resolve(rawPath);
  if (path.extname(resolved).toLowerCase() !== ".json" || /^\\\\/.test(resolved)) {
    fail("local_job_json_required");
  }
  const stat = existingFile(resolved, "local_job_json_required");
  if (stat.size <= 1 || stat.size > MAX_JOB_BYTES) fail("job_json_size_invalid");
  let job;
  try {
    job = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch {
    fail("job_json_invalid");
  }
  if (!isPlainObject(job)) fail("job_json_invalid");
  return { job, jobPath: resolved, jobDirectory: path.dirname(resolved) };
}

async function sha256File(filePath, maxBytes, reason) {
  const stat = existingFile(filePath, reason);
  if (stat.size <= 0 || stat.size > maxBytes) fail(reason);
  const digest = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  }).catch(() => fail(reason));
  return { sha256: digest.digest("hex"), bytes: stat.size };
}

function safeChildEnv(source = process.env) {
  const env = {};
  for (const key of [
    "PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP",
    "CUDA_VISIBLE_DEVICES", "CUDA_DEVICE_ORDER", "PYTHONUTF8", "PYTHONIOENCODING", "PYTHONPATH",
  ]) {
    if (source[key] != null) env[key] = String(source[key]);
  }
  env.HF_HUB_OFFLINE = "1";
  env.TRANSFORMERS_OFFLINE = "1";
  env.DIFFUSERS_OFFLINE = "1";
  env.PYTHONUTF8 = "1";
  env.PYTHONIOENCODING = "utf-8";
  return env;
}

function defaultRunChild(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let timer = null;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const collect = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.length > CHILD_OUTPUT_LIMIT) {
        child.kill();
        finish(() => reject(new Error("child_output_limit")));
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = collect(stderr, chunk); });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code, signal) => finish(() => resolve({
      code: Number.isInteger(code) ? code : -1,
      signal: signal || "",
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
    })));
    const timeoutMs = Number(options.timeoutMs) || 60_000;
    timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("child_timeout")));
    }, timeoutMs);
  });
}

async function command(runChild, commandName, args, options, reason) {
  let result;
  try {
    result = await runChild(commandName, args, options);
  } catch {
    fail(reason);
  }
  if (!result || Number(result.code) !== 0) fail(reason, `exit_${result && result.code}`);
  return String(result.stdout || "");
}

function ratio(value) {
  const match = String(value || "").match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (match && Number(match[2]) !== 0) return Number(match[1]) / Number(match[2]);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function probeMedia(runChild, ffprobe, filePath, options, expectVideo) {
  const stdout = await command(runChild, ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,duration,codec_name:format=duration",
    "-of", "json",
    filePath,
  ], options, "ffprobe_failed");
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    fail("ffprobe_output_invalid");
  }
  const stream = Array.isArray(payload.streams) ? payload.streams[0] : null;
  const width = Number(stream && stream.width);
  const height = Number(stream && stream.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    fail("media_dimensions_invalid");
  }
  const duration = Number(payload.format && payload.format.duration || stream && stream.duration);
  const fps = ratio(stream && stream.avg_frame_rate);
  if (expectVideo && (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(fps) || fps <= 0)) {
    fail("video_metadata_invalid");
  }
  return {
    width,
    height,
    ...(expectVideo ? { durationSeconds: duration, fps, codec: String(stream.codec_name || "") } : {}),
  };
}

function remasterArguments(sourcePath, optimizedPath) {
  return [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "error", "-noautorotate",
    "-i", sourcePath,
    "-frames:v", "1",
    "-vf", REMASTER_FILTER,
    "-map_metadata", "-1",
    "-q:v", "2",
    "-threads", "1",
    "-fflags", "+bitexact",
    "-flags:v", "+bitexact",
    optimizedPath,
  ];
}

function browserArguments(masterPath, browserPath, targetKbps) {
  return [
    "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
    "-i", masterPath,
    "-an",
    "-vf", BROWSER_FILTER,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-level", "4.1",
    "-preset", "slow",
    "-b:v", `${targetKbps}k`,
    "-maxrate", `${targetKbps}k`,
    "-bufsize", `${targetKbps * 2}k`,
    "-g", String(BROWSER_FPS * 2),
    "-keyint_min", String(BROWSER_FPS * 2),
    "-sc_threshold", "0",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-map_metadata", "-1",
    "-fflags", "+bitexact",
    "-flags:v", "+bitexact",
    browserPath,
  ];
}

function ensureOutputDirectory(outputDirectory) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const name of fs.readdirSync(outputDirectory)) {
    if (!GENERATED_NAMES.has(name)) fail("output_directory_not_clean");
  }
}

function validateStaticJob(jobRecord) {
  const { job, jobDirectory } = jobRecord;
  const policy = buildWanHeroPolicy(job);
  if (!policy.ok) fail(policy.reason, policy.detail);
  if (policy.model.id !== WAN_MODEL_ID) fail("wan_model_id_mismatch");
  if (policy.model.revision !== WAN_MODEL_REVISION) fail("wan_model_revision_mismatch");

  const sourcePath = localPath(jobDirectory, job.sourceImagePath, "local_source_image_required");
  const sourceStat = existingFile(sourcePath, "local_source_image_required");
  if (!IMAGE_EXTENSIONS.has(path.extname(sourcePath).toLowerCase()) || sourceStat.size > MAX_SOURCE_BYTES) {
    fail("local_source_image_required");
  }
  const modelPath = existingDirectory(
    localPath(jobDirectory, job.localModelPath, "local_model_directory_required"),
    "local_model_directory_required",
  );
  const wanScriptPath = localPath(jobDirectory, job.wanScriptPath, "wan_i2v_script_required");
  existingFile(wanScriptPath, "wan_i2v_script_required");
  if (path.basename(wanScriptPath).toLowerCase() !== "wan_i2v.py") fail("wan_i2v_script_required");

  const outputRoot = localPath(jobDirectory, job.outputDirectory, "output_directory_required");
  const cacheDigest = policy.cacheKey.split(":").pop();
  const outputDirectory = path.join(outputRoot, cacheDigest);
  const python = executable(jobDirectory, job.pythonExecutable, ["python", "python.exe", "python3", "python3.exe"], "python", "python_executable_invalid");
  const ffmpeg = executable(jobDirectory, job.ffmpegExecutable, ["ffmpeg", "ffmpeg.exe"], "ffmpeg", "ffmpeg_executable_invalid");
  const ffprobe = executable(jobDirectory, job.ffprobeExecutable, ["ffprobe", "ffprobe.exe"], "ffprobe", "ffprobe_executable_invalid");

  const estimatedPowerWatts = finiteNumber(job.estimatedPowerWatts, {
    min: 25, max: 2_000, reason: "estimated_power_watts_required",
  });
  const electricityRateUsdPerKwh = finiteNumber(job.electricityRateUsdPerKwh, {
    min: 0, max: 5, reason: "electricity_rate_required",
  });
  const wanTimeoutSeconds = job.wanTimeoutSeconds == null
    ? 7_200
    : finiteNumber(job.wanTimeoutSeconds, { min: 60, max: 21_600, reason: "wan_timeout_invalid" });

  return {
    policy,
    sourcePath,
    modelPath,
    wanScriptPath,
    outputDirectory,
    python,
    ffmpeg,
    ffprobe,
    estimatedPowerWatts,
    electricityRateUsdPerKwh,
    wanTimeoutMs: wanTimeoutSeconds * 1_000,
  };
}

function dryRunResult(plan, raw) {
  return {
    ok: true,
    dryRun: true,
    cacheKey: plan.policy.cacheKey,
    sourceIdentity: {
      prospectId: plan.policy.prospectId,
      domain: plan.policy.domain,
      type: plan.policy.source.type,
      assetType: plan.policy.source.assetType,
      sha256: raw.sha256,
    },
    model: plan.policy.model,
    generation: {
      preset: plan.policy.preset,
      durationSeconds: plan.policy.durationSeconds,
      overlaySide: plan.policy.overlaySide,
      prompt: plan.policy.prompt,
      negativePrompt: plan.policy.negativePrompt,
    },
    plan: {
      outputDirectory: plan.outputDirectory,
      steps: ["ffprobe_source", "ffmpeg_remaster", "ffprobe_optimized", "wan_i2v", "ffprobe_master", "ffmpeg_browser_16fps", "ffprobe_browser"],
      networkAllowed: false,
      providerCalls: 0,
      uploads: 0,
      sends: 0,
    },
  };
}

function pythonGenerationSettings(settings, durationSeconds) {
  const seed = finiteNumber(settings.seed, { min: 0, max: 0x7fffffff, reason: "wan_seed_required" });
  const numFrames = finiteNumber(settings.numFrames ?? settings.frames, {
    min: 17, max: 161, reason: "wan_num_frames_required",
  });
  const numInferenceSteps = finiteNumber(settings.numInferenceSteps ?? settings.steps, {
    min: 1, max: 60, reason: "wan_inference_steps_required",
  });
  const guidanceScale = finiteNumber(settings.guidanceScale, {
    min: 1, max: 8, reason: "wan_guidance_scale_required",
  });
  const width = finiteNumber(settings.width, { min: 256, max: 832, reason: "wan_width_required" });
  const height = finiteNumber(settings.height, { min: 256, max: 480, reason: "wan_height_required" });
  const fps = finiteNumber(settings.fps ?? BROWSER_FPS, { min: 8, max: 30, reason: "wan_fps_invalid" });
  const quantization = String(settings.quantization || "").trim();
  if (quantization !== WAN_QUANTIZATION) fail("wan_quantization_required");
  if (![seed, numFrames, numInferenceSteps, width, height, fps].every(Number.isInteger)) {
    fail("wan_integer_setting_required");
  }
  if (!ALLOWED_WAN_FRAMES.has(numFrames) || (numFrames - 1) % 4 !== 0) fail("wan_frame_count_invalid");
  if (width % 16 !== 0 || height % 16 !== 0) fail("wan_dimensions_invalid");
  if (Math.abs((numFrames - 1) / fps - durationSeconds) > 0.25) fail("wan_frame_duration_mismatch");
  return { seed, numFrames, numInferenceSteps, guidanceScale, width, height, fps, quantization };
}

function exactPythonText(value, limit, reason) {
  const text = String(value || "");
  if (!text || text.length > limit || text !== text.trim() || text.includes("\u0000")) fail(reason);
  return text;
}

function parseWanReceipt(stdout) {
  const lines = String(stdout || "").split(/\r?\n/).map((line) => line.trim());
  const line = lines.reverse().find((entry) => entry.startsWith("WAN_RESULT "));
  if (!line) fail("wan_result_missing");
  let receipt;
  try {
    receipt = JSON.parse(line.slice("WAN_RESULT ".length));
  } catch {
    fail("wan_result_invalid");
  }
  if (!isPlainObject(receipt) || receipt.ok !== true || !Array.isArray(receipt.jobs) || receipt.jobs.length !== 1) {
    fail("wan_result_invalid");
  }
  return receipt;
}

function receiptPower(receipt) {
  const power = isPlainObject(receipt.power) ? receipt.power : {};
  const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
  return {
    samples: Math.floor(number(power.samples)),
    avgPowerWatts: number(power.avgPowerWatts),
    peakPowerWatts: number(power.peakPowerWatts),
    energyKwh: number(power.energyKwh),
    peakVramMiB: number(power.peakVramMiB),
  };
}

function verifyWanReceipt(receipt, manifest, masterFile) {
  const receiptJob = receipt.jobs[0];
  const expected = manifest.jobs[0];
  const sameNumber = (left, right) => Number.isFinite(Number(left)) && Number(left) === Number(right);
  const mismatch = (
    String(receipt.generator || "") !== "wan2_i2v_local"
    || String(receipt.quantization || "") !== WAN_QUANTIZATION
    || String(receipt.modelRevision || "") !== manifest.modelRevision
    || String(receiptJob.generator || "") !== "wan2_i2v_local"
    || String(receiptJob.id || "") !== expected.id
    || String(receiptJob.prospectId || "") !== expected.prospectId
    || String(receiptJob.domain || "").toLowerCase() !== expected.domain
    || String(receiptJob.sourceSha256 || "").toLowerCase() !== expected.sourceSha256
    || String(receiptJob.promptSha256 || "").toLowerCase() !== expected.promptSha256
    || String(receiptJob.negativePromptSha256 || "").toLowerCase() !== expected.negativePromptSha256
    || path.resolve(String(receiptJob.outputPath || "")) !== path.resolve(expected.outputPath)
    || String(receiptJob.outputSha256 || "").toLowerCase() !== masterFile.sha256
    || !sameNumber(receiptJob.seed, expected.seed)
    || !sameNumber(receiptJob.frames, expected.numFrames)
    || !sameNumber(receiptJob.steps, expected.numInferenceSteps)
    || !sameNumber(receiptJob.guidanceScale, expected.guidanceScale)
    || !sameNumber(receiptJob.width, expected.width)
    || !sameNumber(receiptJob.height, expected.height)
    || !sameNumber(receiptJob.fps, expected.fps)
  );
  if (mismatch) fail("wan_result_identity_mismatch");
}

function pythonManifest(plan, optimized, paths) {
  const settings = pythonGenerationSettings(plan.policy.model.settings, plan.policy.durationSeconds);
  const id = plan.policy.cacheKey.split(":").pop();
  const modelRevision = exactPythonText(plan.policy.model.revision, 120, "model_revision_invalid");
  const prompt = exactPythonText(plan.policy.prompt, 12_000, "prompt_invalid");
  const negativePrompt = exactPythonText(plan.policy.negativePrompt, 8_000, "negative_prompt_invalid");
  return {
    modelPath: plan.modelPath,
    modelRevision,
    jobs: [{
      id,
      prospectId: plan.policy.prospectId,
      domain: plan.policy.domain,
      sourcePath: paths.optimizedPath,
      sourceSha256: optimized.sha256,
      outputPath: paths.masterPath,
      prompt,
      negativePrompt,
      promptSha256: plan.policy.promptSha256,
      negativePromptSha256: plan.policy.negativePromptSha256,
      seed: settings.seed,
      numFrames: settings.numFrames,
      numInferenceSteps: settings.numInferenceSteps,
      guidanceScale: settings.guidanceScale,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
    }],
  };
}

async function runWanJobFile(jobFilePath, dependencies = {}) {
  const runChild = dependencies.runChild || defaultRunChild;
  const nowMs = dependencies.nowMs || (() => Date.now());
  const childEnvironment = safeChildEnv(dependencies.environment || process.env);
  const wallStart = Number(nowMs());
  try {
    const jobRecord = readJob(jobFilePath);
    const plan = validateStaticJob(jobRecord);
    const raw = await sha256File(plan.sourcePath, MAX_SOURCE_BYTES, "source_image_unreadable");
    if (raw.sha256 !== plan.policy.source.sha256) fail("source_sha256_mismatch");
    if (dependencies.dryRun === true) return dryRunResult(plan, raw);

    ensureOutputDirectory(plan.outputDirectory);
    const paths = {
      optimizedPath: path.join(plan.outputDirectory, "optimized-source.jpg"),
      manifestPath: path.join(plan.outputDirectory, "wan-manifest.json"),
      masterPath: path.join(plan.outputDirectory, "wan-master.mp4"),
      browserPath: path.join(plan.outputDirectory, "hero-browser.mp4"),
    };
    if (new Set([paths.optimizedPath, paths.manifestPath, paths.masterPath].map((item) => path.dirname(item))).size !== 1) {
      fail("wan_python_path_boundary_invalid");
    }
    const childBase = { cwd: plan.outputDirectory, env: childEnvironment };
    const rawDimensions = await probeMedia(runChild, plan.ffprobe, plan.sourcePath, {
      ...childBase, timeoutMs: 60_000,
    }, false);

    await command(runChild, plan.ffmpeg, remasterArguments(plan.sourcePath, paths.optimizedPath), {
      ...childBase, timeoutMs: 10 * 60_000,
    }, "ffmpeg_remaster_failed");
    const optimizedFile = await sha256File(paths.optimizedPath, MAX_SOURCE_BYTES, "optimized_image_missing");
    const optimizedDimensions = await probeMedia(runChild, plan.ffprobe, paths.optimizedPath, {
      ...childBase, timeoutMs: 60_000,
    }, false);
    if (optimizedDimensions.width > rawDimensions.width || optimizedDimensions.height > rawDimensions.height) {
      fail("optimized_image_upscaled");
    }
    const optimized = { ...optimizedFile, ...optimizedDimensions };

    const manifest = pythonManifest(plan, optimized, paths);
    const manifestText = `${stableSerialize(manifest)}\n`;
    fs.writeFileSync(paths.manifestPath, manifestText, { encoding: "utf8", mode: 0o600 });
    const manifestSha256 = createHash("sha256").update(manifestText).digest("hex");

    const generationStart = Number(nowMs());
    const wanStdout = await command(runChild, plan.python, [plan.wanScriptPath, "--manifest", paths.manifestPath], {
      ...childBase, timeoutMs: plan.wanTimeoutMs,
    }, "wan_i2v_failed");
    const wanReceipt = parseWanReceipt(wanStdout);
    const generationEnd = Number(nowMs());

    const masterFile = await sha256File(paths.masterPath, MAX_MASTER_BYTES, "wan_master_video_missing");
    verifyWanReceipt(wanReceipt, manifest, masterFile);
    const masterMedia = await probeMedia(runChild, plan.ffprobe, paths.masterPath, {
      ...childBase, timeoutMs: 60_000,
    }, true);
    if (Math.abs(masterMedia.durationSeconds - plan.policy.durationSeconds) > 1) {
      fail("wan_master_duration_mismatch");
    }

    const baseKbps = Math.max(300, Math.min(4_000, Math.floor((MAX_BROWSER_BYTES * 0.88 * 8) / masterMedia.durationSeconds / 1_000)));
    let browserFile = null;
    for (const multiplier of [1, 0.75, 0.55]) {
      const targetKbps = Math.max(250, Math.floor(baseKbps * multiplier));
      await command(runChild, plan.ffmpeg, browserArguments(paths.masterPath, paths.browserPath, targetKbps), {
        ...childBase, timeoutMs: 20 * 60_000,
      }, "ffmpeg_browser_encode_failed");
      const candidate = await sha256File(paths.browserPath, MAX_MASTER_BYTES, "browser_video_missing");
      if (candidate.bytes <= MAX_BROWSER_BYTES) {
        browserFile = candidate;
        break;
      }
    }
    if (!browserFile) fail("browser_video_too_large");
    const browserMedia = await probeMedia(runChild, plan.ffprobe, paths.browserPath, {
      ...childBase, timeoutMs: 60_000,
    }, true);
    if (Math.abs(browserMedia.fps - BROWSER_FPS) > 0.05 || browserMedia.codec !== "h264") {
      fail("browser_video_format_invalid");
    }
    if (browserMedia.width > masterMedia.width || browserMedia.height > masterMedia.height) {
      fail("browser_video_upscaled");
    }
    if (Math.abs(browserMedia.durationSeconds - masterMedia.durationSeconds) > 0.5) {
      fail("browser_video_duration_mismatch");
    }

    const wallEnd = Number(nowMs());
    const wallTimeMs = Math.max(0, wallEnd - wallStart);
    const generationTimeMs = Math.max(0, generationEnd - generationStart);
    const estimatedEnergyKwh = plan.estimatedPowerWatts * wallTimeMs / 3_600_000_000;
    const estimatedElectricityCostUsd = estimatedEnergyKwh * plan.electricityRateUsdPerKwh;
    const gpuPower = receiptPower(wanReceipt);

    return {
      ok: true,
      schemaVersion: JOB_SCHEMA_VERSION,
      cacheKey: plan.policy.cacheKey,
      sourceIdentity: {
        prospectId: plan.policy.prospectId,
        domain: plan.policy.domain,
        type: plan.policy.source.type,
        assetType: plan.policy.source.assetType,
        sha256: raw.sha256,
      },
      model: plan.policy.model,
      generation: {
        preset: plan.policy.preset,
        durationSeconds: plan.policy.durationSeconds,
        overlaySide: plan.policy.overlaySide,
      },
      artifacts: {
        raw: { sha256: raw.sha256, bytes: raw.bytes, ...rawDimensions },
        optimized: {
          path: paths.optimizedPath,
          sha256: optimized.sha256,
          bytes: optimized.bytes,
          width: optimized.width,
          height: optimized.height,
          promptSha256: WAN_REMASTER_RECIPE_SHA256,
          recipeSha256: WAN_REMASTER_RECIPE_SHA256,
        },
        manifest: { path: paths.manifestPath, sha256: manifestSha256 },
        masterVideo: { path: paths.masterPath, sha256: masterFile.sha256, bytes: masterFile.bytes, ...masterMedia },
        browserVideo: { path: paths.browserPath, sha256: browserFile.sha256, bytes: browserFile.bytes, ...browserMedia },
      },
      metrics: {
        wallTimeMs,
        generationTimeMs,
        energy: {
          method: "configured_power_estimate",
          estimatedPowerWatts: plan.estimatedPowerWatts,
          estimatedKwh: Number(estimatedEnergyKwh.toFixed(8)),
          gpuTelemetry: gpuPower,
        },
        electricityRateUsdPerKwh: plan.electricityRateUsdPerKwh,
        estimatedElectricityCostUsd: Number(estimatedElectricityCostUsd.toFixed(6)),
      },
      sideEffects: { providerCalls: 0, fetches: 0, uploads: 0, databaseWrites: 0, emails: 0 },
    };
  } catch (error) {
    return failureResult(error);
  }
}

module.exports = {
  JOB_SCHEMA_VERSION,
  MAX_BROWSER_BYTES,
  BROWSER_FPS,
  REMASTER_FILTER,
  WAN_REMASTER_RECIPE_SHA256,
  BROWSER_FILTER,
  safeChildEnv,
  remasterArguments,
  browserArguments,
  runWanJobFile,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    process.stdout.write(`${JSON.stringify({ ok: false, reason: "local_job_json_required" })}\n`);
    process.exitCode = 1;
  } else {
    runWanJobFile(args[0]).then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      if (!result.ok) process.exitCode = 1;
    });
  }
}
