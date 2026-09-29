"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFile } = require("node:child_process");

const { parseArgs } = require("../scripts/hero-boomerang-worker.cjs");

const FFMPEG_BIN = process.env.GHOST_AGENCY_FFMPEG_BIN || "ffmpeg";

const SCRIPT_PATH = path.resolve(__dirname, "../scripts/hero-boomerang-worker.cjs");

function run(bin, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ""), stderr: String(stderr || ""), ...opts });
    });
  });
}

test("parseArgs accepts space, inline, and default forms", () => {
  assert.deepEqual(parseArgs(["--input", "a.mp4", "--output", "b.mp4"]), { input: "a.mp4", output: "b.mp4" });
  assert.deepEqual(parseArgs(["--input=a.mp4", "--output=b.mp4", "--passes=3"]), { input: "a.mp4", output: "b.mp4", passes: 3 });
  const defaulted = parseArgs(["--input", "a.mp4", "--output", "b.mp4", "--passes", "banana"]);
  assert.deepEqual(defaulted, { input: "a.mp4", output: "b.mp4" });
});

test("parseArgs rejects missing input/output and unknown flags (exit-code-2 path)", () => {
  assert.equal(parseArgs(["--input", "a.mp4"]), null);
  assert.equal(parseArgs([]), null);
  assert.equal(parseArgs(["--input", "a.mp4", "--output", "b.mp4", "--wat"]), null);
});

let ffmpegAvailable = true;
const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "wss-boomerang-cli-"));
const sourcePath = path.join(tmpBase, "source.mp4");
const outputPath = path.join(tmpBase, "hero_8s.mp4");

test.before(async () => {
  const res = await run(FFMPEG_BIN, [
    "-y", "-loglevel", "error",
    "-f", "lavfi", "-i", "testsrc2=duration=4:size=854x480:rate=30",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", sourcePath,
  ]);
  if (res.error) ffmpegAvailable = false;
});

test.after(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

test("CLI turns a 4s source into a valid ping-pong hero and prints one JSON line", async (t) => {
  if (!ffmpegAvailable) return t.skip();
  const res = await run(process.execPath, [SCRIPT_PATH, "--input", sourcePath, "--output", outputPath]);
  assert.ok(!res.error, `CLI failed: ${res.stderr}`);
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  assert.equal(lines.length, 1, "exactly one JSON line expected");
  const result = JSON.parse(lines[0]);
  assert.equal(result.ok, true);
  assert.equal(result.passes, 2);
  assert.ok(result.durationSec >= 7 && result.durationSec <= 9, `durationSec ${result.durationSec}`);
  assert.ok(result.sourceDurationSec >= 3 && result.sourceDurationSec <= 5);
  assert.ok(fs.existsSync(outputPath));
  assert.ok(fs.statSync(outputPath).size > 0);
});

test("CLI exits 2 with a JSON usage line when args are bad", async () => {
  const res = await run(process.execPath, [SCRIPT_PATH]);
  assert.equal(res.error?.code, 2);
  const payload = JSON.parse(res.stdout.trim());
  assert.equal(payload.ok, false);
  assert.match(payload.error, /usage:/);
});
