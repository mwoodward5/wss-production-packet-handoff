"use strict";

// hero-boomerang-worker.cjs
//
// Standalone CLI wrapper around lib/hero-clip-boomerang.boomerangClip for the
// local hero-forge box. No network I/O: reads one Seedance MP4, writes one
// ping-pong hero MP4, prints exactly one JSON result line.
//
//   node hero-boomerang-worker.cjs --input source.mp4 --output hero_8s.mp4 [--passes 2]
//
// Exit codes: 0 ok · 1 boomerang failure · 2 bad args · 3 ffmpeg/ffprobe missing

const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { boomerangClip, DEFAULT_PASSES } = require("../lib/hero-clip-boomerang");

const FFMPEG_BIN = process.env.GHOST_AGENCY_FFMPEG_BIN || "ffmpeg";
const FFPROBE_BIN = process.env.GHOST_AGENCY_FFPROBE_BIN || "ffprobe";

function parseArgs(argv = []) {
  const parsed = {};
  let unknown = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const eq = token.indexOf("=");
    const flag = eq > 0 ? token.slice(0, eq) : token;
    const inlineValue = eq > 0 ? token.slice(eq + 1) : undefined;
    const take = () => (inlineValue !== undefined ? inlineValue : argv[++i]);
    if (flag === "--input") parsed.input = take();
    else if (flag === "--output") parsed.output = take();
    else if (flag === "--passes") parsed.passes = parseInt(take(), 10);
    else unknown = true;
  }
  if (!parsed.input || !parsed.output || unknown) return null;
  if (!Number.isFinite(parsed.passes)) delete parsed.passes;
  return parsed;
}

function probeAvailable(bin) {
  return new Promise((resolve) => {
    execFile(bin, ["-version"], { timeout: 5000 }, (error) => resolve(!error));
  });
}

function videoDimensions(file) {
  return new Promise((resolve) => {
    execFile(
      FFPROBE_BIN,
      ["-v", "error", "-selectStreams", "v:0", "-showEntries", "stream=width,height", "-of", "json", file],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve({ width: null, height: null });
        try {
          const stream = JSON.parse(stdout).streams?.[0] || {};
          resolve({ width: stream.width ?? null, height: stream.height ?? null });
        } catch {
          resolve({ width: null, height: null });
        }
      },
    );
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.log(JSON.stringify({ ok: false, error: "usage: node hero-boomerang-worker.cjs --input <mp4> --output <mp4> [--passes 2]" }));
    process.exitCode = 2;
    return;
  }

  const sourcePath = path.resolve(args.input);
  const outputPath = path.resolve(args.output);
  const passes = Number.isInteger(args.passes) && args.passes >= 2 && args.passes <= 5 ? args.passes : DEFAULT_PASSES;

  if (!fs.existsSync(sourcePath)) {
    console.log(JSON.stringify({ ok: false, error: "input_not_found", detail: sourcePath }));
    process.exitCode = 2;
    return;
  }
  if (!(await probeAvailable(FFMPEG_BIN))) {
    console.log(JSON.stringify({ ok: false, error: "ffmpeg_missing", detail: FFMPEG_BIN }));
    process.exitCode = 3;
    return;
  }

  const sourceBytes = await fs.promises.readFile(sourcePath);
  const result = await boomerangClip(sourceBytes, { passes });

  if (!result.ok) {
    console.log(JSON.stringify({ ok: false, reason: result.reason || "boomerang_failed", detail: result.detail || "" }));
    process.exitCode = result.reason === "boomerang_ffmpeg_missing" ? 3 : 1;
    return;
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, result.bytes);
  const dims = await probeAvailable(FFPROBE_BIN)
    ? await videoDimensions(outputPath)
    : { width: null, height: null };

  console.log(JSON.stringify({
    ok: true,
    output: outputPath,
    durationSec: result.durationSec,
    width: dims.width,
    height: dims.height,
    passes: result.passes,
    sourceDurationSec: result.sourceDurationSec,
  }));
}

if (require.main === module) main().catch((error) => {
  console.log(JSON.stringify({ ok: false, reason: "worker_error", detail: String((error && error.message) || error).slice(0, 200) }));
  process.exitCode = 1;
});

module.exports = { parseArgs };
