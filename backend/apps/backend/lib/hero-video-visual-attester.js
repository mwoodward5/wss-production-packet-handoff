"use strict";

/**
 * Local, provider-independent visual identity gate for generated hero clips.
 *
 * The gate deliberately runs on the owner worker host, after generation and
 * before owner approval. It proves the exact source and staged clip bytes,
 * decodes representative frames with local ffmpeg/ffprobe, and signs the
 * existing visual-gate contract only after all checks pass.
 */

const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { signVisualGateAttestation } = require("./hero-video-visual-gate");

const EVALUATOR = "wss_local_ffmpeg_identity_v1";
const FRAME_SIDE = 64;
const FRAME_BYTES = FRAME_SIDE * FRAME_SIDE * 3;
const MAX_CLIP_BYTES = 250 * 1024 * 1024;
const MAX_SOURCE_BYTES = 4_000_000;
const TOOL_TIMEOUT_MS = 30_000;
const SHA256_RE = /^[a-f0-9]{64}$/;

function clean(value) { return typeof value === "string" ? value.trim() : ""; }

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function sameSha(left, right) {
  const a = clean(left).toLowerCase();
  const b = clean(right).toLowerCase();
  return SHA256_RE.test(a) && SHA256_RE.test(b) && a === b;
}

function pathIsInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function receiptIdentity(receipt) {
  return [
    clean(receipt?.job_id),
    clean(receipt?.prospect_id),
    Number(receipt?.generation_revision) || 0,
    clean(receipt?.source_url),
    clean(receipt?.source_sha256).toLowerCase(),
    path.resolve(clean(receipt?.source_path) || "."),
    clean(receipt?.clip_sha256).toLowerCase(),
    path.resolve(clean(receipt?.clip_path) || "."),
  ].join("\n");
}

function validateReceiptIdentity(receipt) {
  const sourceSha = clean(receipt?.source_sha256).toLowerCase();
  const clipSha = clean(receipt?.clip_sha256).toLowerCase();
  const artifact = receipt?.approved_artifact;
  let source;
  try { source = new URL(clean(receipt?.source_url)); } catch { throw codedError("hero_visual_source_identity_invalid"); }
  if (
    !receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || receipt.status !== "awaiting_review"
    || !clean(receipt.job_id)
    || !clean(receipt.prospect_id)
    || !Number.isInteger(Number(receipt.generation_revision))
    || Number(receipt.generation_revision) < 1
    || source.protocol !== "https:"
    || source.username || source.password
    || !SHA256_RE.test(sourceSha)
    || !SHA256_RE.test(clipSha)
    || !clean(receipt.clip_path)
    || !artifact || typeof artifact !== "object" || Array.isArray(artifact)
    || !sameSha(artifact.raw_sha256, sourceSha)
    || clean(artifact.source_url) !== source.toString()
    || !sameSha(artifact.clip_sha256, clipSha)
  ) throw codedError("hero_visual_source_identity_invalid");
  return { sourceSha, clipSha, sourceUrl: source.toString() };
}

function execFileBuffered(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(executable, args, {
      encoding: options.encoding || "buffer",
      windowsHide: true,
      timeout: options.timeoutMs || TOOL_TIMEOUT_MS,
      maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        error.toolStderr = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || "");
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function toolError(error, missingCode, failedCode) {
  if (error?.code === "ENOENT") return codedError(missingCode);
  return codedError(failedCode);
}

async function probeClip(clipPath, options = {}) {
  const executable = clean(options.ffprobeExecutable) || "ffprobe";
  let output;
  try {
    output = await (options.execFileImpl || execFileBuffered)(executable, [
      "-v", "error", "-select_streams", "v:0",
      "-count_frames",
      "-show_entries", "stream=codec_type,width,height,avg_frame_rate,nb_frames,nb_read_frames,duration:format=duration",
      "-of", "json", clipPath,
    ], { encoding: "utf8" });
  } catch (error) {
    throw toolError(error, "hero_visual_ffprobe_unavailable", "hero_visual_clip_probe_failed");
  }
  let parsed;
  try { parsed = JSON.parse(String(output || "")); } catch { throw codedError("hero_visual_clip_probe_invalid"); }
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
  const duration = Number(stream?.duration || parsed?.format?.duration);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const frameCount = Number(stream?.nb_read_frames || stream?.nb_frames);
  if (
    !stream || stream.codec_type !== "video"
    || !Number.isFinite(duration) || duration <= 0
    || !Number.isInteger(width) || width < 2
    || !Number.isInteger(height) || height < 2
    || (Number.isFinite(frameCount) && frameCount < 2)
  ) throw codedError("hero_visual_clip_probe_invalid");
  return { duration, width, height, frameCount: Number.isFinite(frameCount) ? frameCount : null };
}

async function decodeRgb(inputPath, options = {}) {
  const executable = clean(options.ffmpegExecutable) || "ffmpeg";
  const args = ["-v", "error"];
  if (Number.isFinite(options.atSeconds)) args.push("-ss", String(Math.max(0, options.atSeconds)));
  args.push(
    "-i", inputPath,
    "-frames:v", "1",
    "-vf", `scale=${FRAME_SIDE}:${FRAME_SIDE}:force_original_aspect_ratio=increase:flags=bilinear,crop=${FRAME_SIDE}:${FRAME_SIDE}`,
    "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
  );
  let output;
  try {
    output = await (options.execFileImpl || execFileBuffered)(executable, args, { encoding: "buffer" });
  } catch (error) {
    throw toolError(error, "hero_visual_ffmpeg_unavailable", "hero_visual_frame_decode_failed");
  }
  const bytes = Buffer.from(output || []);
  if (bytes.length !== FRAME_BYTES) throw codedError("hero_visual_frame_decode_invalid");
  return bytes;
}

function lumaFrame(rgb) {
  const out = new Float64Array(FRAME_SIDE * FRAME_SIDE);
  for (let src = 0, dst = 0; src < rgb.length; src += 3, dst += 1) {
    out[dst] = (0.2126 * rgb[src]) + (0.7152 * rgb[src + 1]) + (0.0722 * rgb[src + 2]);
  }
  return out;
}

function frameStats(rgb) {
  const luma = lumaFrame(rgb);
  let sum = 0;
  for (const value of luma) sum += value;
  const mean = sum / luma.length;
  let variance = 0;
  for (const value of luma) variance += (value - mean) ** 2;
  variance /= luma.length;
  return { luma, mean, stddev: Math.sqrt(variance) };
}

function histogram(rgb) {
  const bins = new Float64Array(48);
  const pixels = rgb.length / 3;
  for (let index = 0; index < rgb.length; index += 3) {
    bins[Math.min(15, rgb[index] >> 4)] += 1;
    bins[16 + Math.min(15, rgb[index + 1] >> 4)] += 1;
    bins[32 + Math.min(15, rgb[index + 2] >> 4)] += 1;
  }
  for (let index = 0; index < bins.length; index += 1) bins[index] /= pixels * 3;
  return bins;
}

function histogramIntersection(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += Math.min(left[index], right[index]);
  return score;
}

function blockSignature(luma) {
  const result = new Float64Array(64);
  const block = FRAME_SIDE / 8;
  for (let by = 0; by < 8; by += 1) {
    for (let bx = 0; bx < 8; bx += 1) {
      let sum = 0;
      for (let y = by * block; y < (by + 1) * block; y += 1) {
        for (let x = bx * block; x < (bx + 1) * block; x += 1) sum += luma[(y * FRAME_SIDE) + x];
      }
      result[(by * 8) + bx] = sum / (block * block);
    }
  }
  return result;
}

function correlation(left, right) {
  let leftMean = 0;
  let rightMean = 0;
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index];
    rightMean += right[index];
  }
  leftMean /= left.length;
  rightMean /= right.length;
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] - leftMean;
    const b = right[index] - rightMean;
    numerator += a * b;
    leftPower += a * a;
    rightPower += b * b;
  }
  if (leftPower < 1e-9 || rightPower < 1e-9) return -1;
  return numerator / Math.sqrt(leftPower * rightPower);
}

function meanAbsoluteDifference(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += Math.abs(left[index] - right[index]);
  return total / left.length;
}

function meanAbsoluteValue(values) {
  let total = 0;
  for (const value of values) total += Math.abs(value);
  return total / values.length;
}

function correlationAtShift(left, right, shiftX, shiftY) {
  const xStart = Math.max(0, -shiftX);
  const xEnd = Math.min(FRAME_SIDE, FRAME_SIDE - shiftX);
  const yStart = Math.max(0, -shiftY);
  const yEnd = Math.min(FRAME_SIDE, FRAME_SIDE - shiftY);
  const count = (xEnd - xStart) * (yEnd - yStart);
  if (count < (FRAME_SIDE * FRAME_SIDE * 0.7)) return -1;
  let leftMean = 0;
  let rightMean = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      leftMean += left[(y * FRAME_SIDE) + x];
      rightMean += right[((y + shiftY) * FRAME_SIDE) + x + shiftX];
    }
  }
  leftMean /= count;
  rightMean /= count;
  let numerator = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const a = left[(y * FRAME_SIDE) + x] - leftMean;
      const b = right[((y + shiftY) * FRAME_SIDE) + x + shiftX] - rightMean;
      numerator += a * b;
      leftPower += a * a;
      rightPower += b * b;
    }
  }
  if (leftPower < 1e-9 || rightPower < 1e-9) return -1;
  return numerator / Math.sqrt(leftPower * rightPower);
}

function alignedCorrelation(left, right, maxShift = 4) {
  let best = -1;
  for (let shiftY = -maxShift; shiftY <= maxShift; shiftY += 1) {
    for (let shiftX = -maxShift; shiftX <= maxShift; shiftX += 1) {
      best = Math.max(best, correlationAtShift(left, right, shiftX, shiftY));
    }
  }
  return best;
}

function highPass(luma) {
  const result = new Float64Array(luma.length);
  for (let y = 1; y < FRAME_SIDE - 1; y += 1) {
    for (let x = 1; x < FRAME_SIDE - 1; x += 1) {
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) neighbors += luma[((y + dy) * FRAME_SIDE) + x + dx];
      }
      const index = (y * FRAME_SIDE) + x;
      result[index] = luma[index] - (neighbors / 9);
    }
  }
  return result;
}

function gradients(luma) {
  const dx = new Float64Array(luma.length);
  const dy = new Float64Array(luma.length);
  for (let y = 1; y < FRAME_SIDE - 1; y += 1) {
    for (let x = 1; x < FRAME_SIDE - 1; x += 1) {
      const tl = luma[((y - 1) * FRAME_SIDE) + x - 1];
      const tc = luma[((y - 1) * FRAME_SIDE) + x];
      const tr = luma[((y - 1) * FRAME_SIDE) + x + 1];
      const ml = luma[(y * FRAME_SIDE) + x - 1];
      const mr = luma[(y * FRAME_SIDE) + x + 1];
      const bl = luma[((y + 1) * FRAME_SIDE) + x - 1];
      const bc = luma[((y + 1) * FRAME_SIDE) + x];
      const br = luma[((y + 1) * FRAME_SIDE) + x + 1];
      const index = (y * FRAME_SIDE) + x;
      dx[index] = (-tl + tr) + (-2 * ml) + (2 * mr) + (-bl + br);
      dy[index] = (-tl - (2 * tc) - tr) + bl + (2 * bc) + br;
    }
  }
  return { dx, dy };
}

function gradientSimilarityAtShift(left, right, shiftX, shiftY) {
  const xStart = Math.max(1, 1 - shiftX);
  const xEnd = Math.min(FRAME_SIDE - 1, FRAME_SIDE - 1 - shiftX);
  const yStart = Math.max(1, 1 - shiftY);
  const yEnd = Math.min(FRAME_SIDE - 1, FRAME_SIDE - 1 - shiftY);
  let dot = 0;
  let leftPower = 0;
  let rightPower = 0;
  for (let y = yStart; y < yEnd; y += 1) {
    for (let x = xStart; x < xEnd; x += 1) {
      const leftIndex = (y * FRAME_SIDE) + x;
      const rightIndex = ((y + shiftY) * FRAME_SIDE) + x + shiftX;
      const ldx = left.dx[leftIndex];
      const ldy = left.dy[leftIndex];
      const rdx = right.dx[rightIndex];
      const rdy = right.dy[rightIndex];
      dot += (ldx * rdx) + (ldy * rdy);
      leftPower += (ldx * ldx) + (ldy * ldy);
      rightPower += (rdx * rdx) + (rdy * rdy);
    }
  }
  if (leftPower < 1e-9 || rightPower < 1e-9) return -1;
  return dot / Math.sqrt(leftPower * rightPower);
}

function alignedGradientSimilarity(left, right, maxShift = 4) {
  let best = -1;
  for (let shiftY = -maxShift; shiftY <= maxShift; shiftY += 1) {
    for (let shiftX = -maxShift; shiftX <= maxShift; shiftX += 1) {
      best = Math.max(best, gradientSimilarityAtShift(left, right, shiftX, shiftY));
    }
  }
  return best;
}

function differenceFrame(left, right) {
  const result = new Float64Array(left.length);
  for (let index = 0; index < left.length; index += 1) result[index] = right[index] - left[index];
  return result;
}

function localVarianceMap(luma, cellSize = 4) {
  const cells = FRAME_SIDE / cellSize;
  const result = new Float64Array(cells * cells);
  for (let by = 0; by < cells; by += 1) {
    for (let bx = 0; bx < cells; bx += 1) {
      let sum = 0;
      let squared = 0;
      for (let y = by * cellSize; y < (by + 1) * cellSize; y += 1) {
        for (let x = bx * cellSize; x < (bx + 1) * cellSize; x += 1) {
          const value = luma[(y * FRAME_SIDE) + x];
          sum += value;
          squared += value * value;
        }
      }
      const count = cellSize * cellSize;
      const mean = sum / count;
      result[(by * cells) + bx] = Math.max(0, (squared / count) - (mean * mean));
    }
  }
  return result;
}

function localDetailCoverage(sourceMap, frameMap) {
  let eligible = 0;
  let retained = 0;
  for (let index = 0; index < sourceMap.length; index += 1) {
    const sourceVariance = sourceMap[index];
    if (sourceVariance < 9) continue;
    eligible += 1;
    const frameVariance = frameMap[index];
    if (frameVariance >= Math.max(2, sourceVariance * 0.08)) retained += 1;
  }
  return eligible ? retained / eligible : 0;
}

function identityMetrics(source, sourceFeatures, frame) {
  const frameHighPass = highPass(frame.luma);
  return {
    histogram: histogramIntersection(sourceFeatures.histogram, histogram(frame.rgb)),
    spatial: alignedCorrelation(source.luma, frame.luma),
    highPass: alignedCorrelation(sourceFeatures.highPass, frameHighPass),
    edge: alignedGradientSimilarity(sourceFeatures.gradients, gradients(frame.luma)),
    detailCoverage: localDetailCoverage(sourceFeatures.localVariance, localVarianceMap(frame.luma)),
    lumaDifference: meanAbsoluteDifference(source.luma, frame.luma),
    highPassFrame: frameHighPass,
    checkerX: correlationAtShift(frameHighPass, frameHighPass, 1, 0),
    checkerY: correlationAtShift(frameHighPass, frameHighPass, 0, 1),
  };
}

function inspectFrames(sourceRgb, clipFrames) {
  const source = frameStats(sourceRgb);
  if (source.stddev < 4 || source.mean < 4 || source.mean > 251) {
    throw codedError("hero_visual_source_frame_blank");
  }
  const sourceHistogram = histogram(sourceRgb);
  const frames = clipFrames.map((rgb) => ({ rgb, ...frameStats(rgb) }));
  const blankCount = frames.filter((frame) => frame.stddev < 3 || frame.mean < 3 || frame.mean > 252).length;
  if (blankCount > Math.floor(frames.length / 3)) throw codedError("hero_visual_clip_blank");

  const motion = [];
  for (let index = 1; index < frames.length; index += 1) {
    motion.push(meanAbsoluteDifference(frames[index - 1].luma, frames[index].luma));
  }
  const maxMotion = Math.max(...motion, 0);
  const averageMotion = motion.reduce((sum, value) => sum + value, 0) / Math.max(1, motion.length);
  if (maxMotion < 0.75 || averageMotion < 0.2) throw codedError("hero_visual_clip_frozen");

  // Alternating frame corruption can preserve every global average while
  // reversing the high-frequency residual on each sample. Two strong A/B/A
  // reversals are flicker, not camera motion.
  const temporalDifferences = [];
  for (let index = 1; index < frames.length; index += 1) {
    temporalDifferences.push(differenceFrame(frames[index - 1].luma, frames[index].luma));
  }
  let strongReversals = 0;
  for (let index = 1; index < temporalDifferences.length; index += 1) {
    const priorPower = meanAbsoluteValue(temporalDifferences[index - 1]);
    const currentPower = meanAbsoluteValue(temporalDifferences[index]);
    if (priorPower > 2 && currentPower > 2 && correlation(temporalDifferences[index - 1], temporalDifferences[index]) < -0.88) {
      strongReversals += 1;
    }
  }
  if (strongReversals >= 2) throw codedError("hero_visual_clip_temporal_flicker");

  const sourceFeatures = {
    histogram: sourceHistogram,
    highPass: highPass(source.luma),
    gradients: gradients(source.luma),
    localVariance: localVarianceMap(source.luma),
  };
  const identities = frames.map((frame) => identityMetrics(source, sourceFeatures, frame));
  const checkerFrames = identities.filter((row) => row.checkerX < -0.05 && row.checkerY < -0.30).length;
  if (checkerFrames >= Math.ceil(frames.length * 0.6)) throw codedError("hero_visual_clip_mosaic");
  const strongMatches = identities.filter((row) => (
    row.spatial >= 0.24 && row.histogram >= 0.30 && row.highPass >= 0.035 && row.edge >= 0.075
    && row.detailCoverage >= 0.60
  )).length;
  const credibleMatches = identities.filter((row) => (
    row.spatial >= 0.08 && row.histogram >= 0.28 && row.highPass >= 0.005 && row.edge >= 0.02
    && row.detailCoverage >= 0.50
  )).length;
  const severeOutliers = identities.filter((row) => (
    row.spatial < -0.05 || row.histogram < 0.20 || (row.highPass < -0.10 && row.edge < -0.05)
  )).length;
  if (strongMatches < 1 || credibleMatches < Math.ceil(frames.length * 0.6) || severeOutliers > 1) {
    throw codedError("hero_visual_source_identity_mismatch");
  }
  return {
    blankCount,
    maxMotion,
    averageMotion,
    strongMatches,
    credibleMatches,
    severeOutliers,
    checkerFrames,
    maxHistogram: Math.max(...identities.map((row) => row.histogram)),
    maxSpatial: Math.max(...identities.map((row) => row.spatial)),
    maxHighPass: Math.max(...identities.map((row) => row.highPass)),
    maxEdge: Math.max(...identities.map((row) => row.edge)),
    maxDetailCoverage: Math.max(...identities.map((row) => row.detailCoverage)),
    bestLumaDifference: Math.min(...identities.map((row) => row.lumaDifference)),
  };
}

async function hashFile(filePath, options = {}) {
  const fsImpl = options.fsImpl || fs;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fsImpl.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function persistAttestation(receiptPath, expectedIdentity, updated, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const current = JSON.parse(await fsPromises.readFile(receiptPath, "utf8"));
  if (receiptIdentity(current) !== expectedIdentity || current.status !== "awaiting_review") {
    throw codedError("hero_visual_receipt_changed");
  }
  const temp = `${receiptPath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fsPromises.writeFile(temp, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await fsPromises.rename(temp, receiptPath);
  } finally {
    await fsPromises.rm(temp, { force: true }).catch(() => null);
  }
}

async function defaultDownloadSource(receipt, tempDir, options = {}) {
  // Lazy import keeps this verifier provider-free. This helper contributes only
  // the already-hardened public-URL/DNS-pinning and bounded-byte download path.
  const { downloadAndVerifySource } = require("../scripts/ads-station/hero-forge-worker.cjs");
  return downloadAndVerifySource(
    { url: clean(receipt.source_url), sha256: clean(receipt.source_sha256).toLowerCase() },
    tempDir,
    options.fetchImpl,
    { lookupImpl: options.lookupImpl, httpsImpl: options.httpsImpl, timeoutMs: options.fetchTimeoutMs },
  );
}

async function stagePersistedSource(receipt, realRoot, tempDir, options = {}) {
  const fsPromises = options.fsPromises || fs.promises;
  const sourceSha = clean(receipt?.source_sha256).toLowerCase();
  const sourcePath = path.resolve(clean(receipt?.source_path));
  const sourceStat = await fsPromises.lstat(sourcePath).catch(() => null);
  const realSource = await fsPromises.realpath(sourcePath).catch(() => "");
  if (
    !sourceStat?.isFile() || sourceStat.isSymbolicLink()
    || sourceStat.size < 1 || sourceStat.size > MAX_SOURCE_BYTES
    || !realSource || !pathIsInside(realRoot, realSource)
    || !new RegExp(`^${sourceSha}\\.(?:jpg|png|webp|gif|avif)$`, "i").test(path.basename(realSource))
  ) throw codedError("hero_visual_source_path_refused");
  const bytes = await fsPromises.readFile(realSource);
  const actualSourceSha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (!sameSha(actualSourceSha, sourceSha)) throw codedError("hero_visual_source_sha256_mismatch");
  const stagedPath = path.join(tempDir, path.basename(realSource));
  await fsPromises.writeFile(stagedPath, bytes, { flag: "wx", mode: 0o600 });
  return { filePath: stagedPath, sha256: actualSourceSha };
}

async function attestVisualGateReceipt(entry, options = {}) {
  const secret = clean(options.secret);
  if (secret.length < 32) throw codedError("hero_visual_gate_secret_required");
  const fsPromises = options.fsPromises || fs.promises;
  const receiptPath = path.resolve(clean(entry?.path));
  const reviewRoot = path.resolve(clean(options.reviewRoot));
  if (!clean(entry?.path) || !clean(options.reviewRoot)) throw codedError("hero_visual_receipt_path_refused");
  const realRoot = await fsPromises.realpath(reviewRoot).catch(() => "");
  const receiptStat = await fsPromises.lstat(receiptPath).catch(() => null);
  const realReceipt = await fsPromises.realpath(receiptPath).catch(() => "");
  if (!realRoot || !receiptStat?.isFile() || receiptStat.isSymbolicLink() || !realReceipt || !pathIsInside(realRoot, realReceipt)) {
    throw codedError("hero_visual_receipt_path_refused");
  }
  let receipt;
  try { receipt = JSON.parse(await fsPromises.readFile(realReceipt, "utf8")); }
  catch { throw codedError("hero_visual_receipt_invalid"); }
  if (entry.raw && receiptIdentity(entry.raw) !== receiptIdentity(receipt)) throw codedError("hero_visual_receipt_changed");
  const identity = validateReceiptIdentity(receipt);
  if (path.basename(realReceipt).toLowerCase() !== `${identity.clipSha}.json`) {
    throw codedError("hero_visual_receipt_path_refused");
  }

  const clipStat = await fsPromises.lstat(path.resolve(receipt.clip_path)).catch(() => null);
  const realClip = await fsPromises.realpath(path.resolve(receipt.clip_path)).catch(() => "");
  if (
    !clipStat?.isFile() || clipStat.isSymbolicLink()
    || clipStat.size < 32 || clipStat.size > MAX_CLIP_BYTES
    || !realClip || !pathIsInside(realRoot, realClip)
    || path.basename(realClip).toLowerCase() !== `${identity.clipSha}.mp4`
  ) throw codedError("hero_visual_clip_path_refused");
  const actualClipSha = await (options.hashFileImpl || hashFile)(realClip, options);
  if (!sameSha(actualClipSha, identity.clipSha)) throw codedError("hero_visual_clip_sha256_mismatch");

  const tempDir = await fsPromises.mkdtemp(path.join(clean(options.tempRoot) || os.tmpdir(), "wss-hero-attest-"));
  try {
    const staged = clean(receipt.source_path)
      ? await stagePersistedSource(receipt, realRoot, tempDir, options)
      : await (options.downloadSourceImpl || defaultDownloadSource)(receipt, tempDir, options);
    const sourcePath = path.resolve(clean(staged?.filePath));
    const sourceStat = await fsPromises.lstat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink() || !pathIsInside(tempDir, sourcePath)) {
      throw codedError("hero_visual_source_stage_invalid");
    }
    const actualSourceSha = await (options.hashFileImpl || hashFile)(sourcePath, options);
    if (!sameSha(actualSourceSha, identity.sourceSha)) throw codedError("hero_visual_source_sha256_mismatch");

    const ffprobeExecutable = clean(options.ffprobeExecutable)
      || clean(options.env?.GHOST_AGENCY_WAN_FFPROBE)
      || clean(options.env?.WSS_WAN_FFPROBE)
      || clean(options.env?.FFPROBE_PATH)
      || "ffprobe";
    const ffmpegExecutable = clean(options.ffmpegExecutable)
      || clean(options.env?.GHOST_AGENCY_WAN_FFMPEG)
      || clean(options.env?.WSS_WAN_FFMPEG)
      || clean(options.env?.FFMPEG_PATH)
      || "ffmpeg";
    const probe = await (options.probeImpl || probeClip)(realClip, { ...options, ffprobeExecutable });
    const decode = options.decodeImpl || decodeRgb;
    const sourceFrame = await decode(sourcePath, { ...options, ffmpegExecutable });
    const fractions = [0.02, 0.22, 0.50, 0.78, 0.96];
    const frames = [];
    for (const fraction of fractions) {
      frames.push(await decode(realClip, {
        ...options,
        ffmpegExecutable,
        atSeconds: Math.min(Math.max(0, probe.duration - 0.02), probe.duration * fraction),
      }));
    }
    (options.inspectFramesImpl || inspectFrames)(sourceFrame, frames);

    const gate = signVisualGateAttestation(receipt, {
      verdict: "passed",
      evaluator: EVALUATOR,
      checked_at: new Date(Number(options.nowMs?.() ?? Date.now())).toISOString(),
    }, secret);
    const updated = { ...receipt, visual_gate: gate };
    await (options.persistImpl || persistAttestation)(realReceipt, receiptIdentity(receipt), updated, options);
    return { ok: true, receipt: updated, gate };
  } finally {
    await fsPromises.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

module.exports = {
  EVALUATOR,
  FRAME_BYTES,
  FRAME_SIDE,
  attestVisualGateReceipt,
  alignedCorrelation,
  alignedGradientSimilarity,
  blockSignature,
  correlation,
  decodeRgb,
  frameStats,
  gradients,
  hashFile,
  highPass,
  histogram,
  histogramIntersection,
  inspectFrames,
  identityMetrics,
  localDetailCoverage,
  localVarianceMap,
  persistAttestation,
  probeClip,
  receiptIdentity,
  stagePersistedSource,
  validateReceiptIdentity,
};
