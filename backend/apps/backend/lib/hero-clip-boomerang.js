"use strict";

// hero-clip-boomerang.js
//
// Turns a short source clip into a longer "ping-pong" loop using ffmpeg — no
// second render is paid for. A 4-second Seedance clip becomes a 12-second hero
// (forward -> reverse -> forward) for the cost of a single 4-second render.
//
// This runs in the hero forge worker (a Node process with ffmpeg on PATH), NOT
// in Vercel's serverless environment. It is invoked between clip download and
// the uploadApproved step in lib/hero-seedance-runner.js.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateHeroClip, SEEDANCE_DURATION_SEC, MAX_CLIP_BYTES } = require("./hero-clip-validation");

const FFMPEG_BIN = process.env.GHOST_AGENCY_FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.GHOST_AGENCY_FFPROBE_BIN || "ffprobe";
const BOOMERANG_TIMEOUT_MS = Number(process.env.GHOST_AGENCY_BOOMERANG_TIMEOUT_MS) || 60000;
// 3 passes of a 4s clip = 12s (F -> R -> F). 2 passes = 8s (F -> R).
const DEFAULT_PASSES = 2;

function run(bin, args, { timeoutMs, maxBuffer }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = execFile(
        bin,
        args,
        { timeout: timeoutMs, maxBuffer, windowsHide: true },
        (error, stdout, stderr) => {
          if (!error) return resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
          const timedOut = error.killed === true || error.signal === "SIGTERM";
          const missing = error.code === "ENOENT";
          resolve({
            ok: false,
            timedOut,
            missing,
            code: error.code,
            message: String(error.message || error).slice(0, 400),
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
          });
        },
      );
    } catch (e) {
      return resolve({ ok: false, missing: true, message: String((e && e.message) || e).slice(0, 400) });
    }
    if (child && typeof child.on === "function") child.on("error", () => {});
  });
}

function tailError(stderr, limit = 240) {
  const lines = String(stderr || "").trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-3).join(" | ").slice(0, limit) || "ffmpeg_failed";
}

/**
 * Probe the duration of a clip via ffprobe. Returns seconds or null.
 */
async function probeDurationSeconds(inputPath) {
  const args = ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath];
  const res = await run(FFPROBE_BIN, args, { timeoutMs: 15000, maxBuffer: 64 * 1024 });
  if (!res.ok) return null;
  const value = parseFloat(String(res.stdout).trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Make a boomerang video from a source clip buffer.
 *
 * forward + reverse + forward (+ reverse ...) laid down with the concat filter,
 * so a 4-second clip becomes 12 seconds (3 passes) or 8 seconds (2 passes) with
 * zero additional render cost — the reversed frames are produced locally by
 * ffmpeg from the SAME source bytes.
 *
 * @param {Buffer} sourceBytes - the raw source clip (e.g. a 4s Seedance mp4)
 * @param {object} [opts]
 * @param {number} [opts.passes=3] - how many times to lay the clip down
 * @param {string} [opts.workDir] - temp directory for intermediate files
 * @returns {Promise<{ok:true,bytes:Buffer,durationSec:number,passes:number,sourceDurationSec:number}|{ok:false,reason:string,detail?:string}>}
 */
async function boomerangClip(sourceBytes, opts = {}) {
  const passes = Number.isInteger(opts.passes) && opts.passes >= 2 && opts.passes <= 5 ? opts.passes : DEFAULT_PASSES;
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length === 0) {
    return { ok: false, reason: "boomerang_source_empty" };
  }
  if (sourceBytes.length > MAX_CLIP_BYTES) {
    return { ok: false, reason: "boomerang_source_too_large" };
  }

      const source = validateHeroClip(sourceBytes, { forbidAudio: true, minAspect: 0.5, maxAspect: 4.0 });
  if (!source.ok) {
    return { ok: false, reason: `boomerang_source_${source.reason}`, detail: source.detail || "" };
  }
  const sourceDurationSec = source.durationSec;

  const workDir = path.resolve(opts.workDir || fs.mkdtempSync(path.join(os.tmpdir(), "wss-boomerang-")));
  await fs.promises.mkdir(workDir, { recursive: true }).catch(() => {});
  const inputPath = path.join(workDir, "source.mp4");
  const outputPath = path.join(workDir, "boomerang.mp4");

  try {
    await fs.promises.writeFile(inputPath, sourceBytes);

    // Build the concat filter graph: [0:v]reverse[r]; then alternate [0:v]/[r]
    // for `passes` segments, concat with a=0 (no audio — source is silent).
    const segments = [];
    for (let i = 0; i < passes; i++) {
      segments.push(i % 2 === 0 ? "[0:v]" : "[r]");
    }
    const filter = `[0:v]reverse[r];${segments.join("")}concat=n=${passes}:v=1:a=0[out]`;

    const args = [
      "-y",
      "-i", inputPath,
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ];

    const res = await run(FFMPEG_BIN, args, { timeoutMs: BOOMERANG_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    if (!res.ok) {
      return {
        ok: false,
        reason: res.missing ? "boomerang_ffmpeg_missing" : (res.timedOut ? "boomerang_ffmpeg_timeout" : "boomerang_ffmpeg_failed"),
        detail: res.missing ? FFMPEG_BIN : tailError(res.stderr),
      };
    }

    const bytes = await fs.promises.readFile(outputPath);
    if (!bytes || bytes.length === 0) {
      return { ok: false, reason: "boomerang_output_empty" };
    }
    if (bytes.length > MAX_CLIP_BYTES) {
      return { ok: false, reason: "boomerang_output_too_large", detail: `${bytes.length}>${MAX_CLIP_BYTES}` };
    }

        const output = validateHeroClip(bytes, { forbidAudio: true, minAspect: 0.5, maxAspect: 4.0 });
    if (!output.ok) {
      return { ok: false, reason: `boomerang_output_${output.reason}`, detail: output.detail || "" };
    }

    return {
      ok: true,
      bytes,
      durationSec: output.durationSec,
      passes,
      sourceDurationSec,
    };
  } catch (e) {
    return { ok: false, reason: "boomerang_error", detail: String((e && e.message) || e).slice(0, 200) };
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  boomerangClip,
  probeDurationSeconds,
  DEFAULT_PASSES,
  BOOMERANG_TIMEOUT_MS,
};
