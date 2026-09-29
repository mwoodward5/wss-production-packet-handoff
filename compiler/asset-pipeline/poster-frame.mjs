// Technical poster fallback. Extracts a still from an existing MP4 for use as
// the <video poster="..."> attribute. This is NOT a creative source — it only
// exists so the video element has a poster while loading.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

export function extractPoster(videoPath, outDir, atSeconds = 1.2) {
  if (!existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, "poster.jpg");
  execFileSync("ffmpeg", [
    "-y", "-ss", String(atSeconds), "-i", videoPath,
    "-frames:v", "1", "-q:v", "3", out,
  ]);
  return out;
}
