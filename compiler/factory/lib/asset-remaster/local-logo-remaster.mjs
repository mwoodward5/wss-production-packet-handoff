// Local, provider-free logo remaster. Turns a scraped/GBP logo into a crisp,
// background-dropped, trimmed, upscaled PNG so the client sees THEIR mark
// looking better than they ever have — never a lazy name box.
//
// Truth-safe: this only cleans and re-presents the EXISTING logo pixels
// (background removal, trim, sharpen, upscale). It never fabricates a mark.
// If the source can't be fetched or decoded, it returns { performed:false }
// and the caller keeps the original URL.

import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

async function loadSharp() {
  try {
    const mod = await import("sharp");
    return mod.default ?? mod;
  } catch {}
  // Fallback: resolve from a globally-installed sharp (dev boxes / CI where
  // sharp isn't a project dependency). Production installs it via
  // optionalDependencies.
  try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    for (const spec of ["sharp", `${process.env.npm_config_prefix || `${process.env.HOME || ""}/.npm-global`}/lib/node_modules/sharp`]) {
      try { return require(spec); } catch {}
    }
  } catch {}
  return null;
}

async function readSource(url) {
  if (!url) return null;
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma < 0) return null;
    const meta = url.slice(5, comma);
    const body = url.slice(comma + 1);
    return meta.includes("base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body));
  }
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url).catch(() => null);
    if (!res || !res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  // Local path (already staged into media/).
  return readFile(url).catch(() => null);
}

// Drop a near-uniform background (common on scraped JPGs/PNGs): sample the
// four corners; if they agree on a light or dark flat color, key it to
// transparent with a tolerance band. Conservative — bails when corners
// disagree (photographic / already-transparent logos are left intact).
async function keyBackground(sharp, input) {
  const img = sharp(input, { failOn: "none" }).ensureAlpha();
  const { width, height } = await img.metadata();
  if (!width || !height) return { buffer: input, keyed: false };
  const raw = await img.raw().toBuffer();
  const at = (x, y) => { const i = (y * width + x) * 4; return [raw[i], raw[i + 1], raw[i + 2], raw[i + 3]]; };
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  if (corners.some((c) => c[3] < 250)) return { buffer: input, keyed: false }; // already has transparency
  const [r, g, b] = corners[0];
  const near = (c) => Math.abs(c[0] - r) < 12 && Math.abs(c[1] - g) < 12 && Math.abs(c[2] - b) < 12;
  if (!corners.every(near)) return { buffer: input, keyed: false };
  const tol = 42;
  const out = Buffer.from(raw);
  for (let i = 0; i < out.length; i += 4) {
    if (Math.abs(out[i] - r) < tol && Math.abs(out[i + 1] - g) < tol && Math.abs(out[i + 2] - b) < tol) out[i + 3] = 0;
  }
  const buffer = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { buffer, keyed: true };
}

export async function remasterLogoLocal(sourceUrl, mediaDir, { name = "brand-remastered.png" } = {}) {
  const sharp = await loadSharp();
  if (!sharp) return { performed: false, reason: "no-sharp" };
  const input = await readSource(sourceUrl);
  if (!input || !input.length) return { performed: false, reason: "input-missing" };
  try {
    const { buffer: keyedBuf, keyed } = await keyBackground(sharp, input);
    const meta = await sharp(keyedBuf, { failOn: "none" }).metadata();
    if (!meta.width || !meta.height) return { performed: false, reason: "undecodable" };
    // Trim transparent margins, then upscale small marks to a crisp target and
    // gently sharpen. Fit inside a padded square so it drops cleanly on any bg.
    const target = 512;
    const out = await sharp(keyedBuf, { failOn: "none" })
      .ensureAlpha()
      .trim({ threshold: 6 })
      .resize({ width: target, height: target, fit: "inside", withoutEnlargement: false })
      .sharpen({ sigma: 0.8 })
      .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const rel = `media/${name}`;
    await writeFile(path.join(mediaDir, name), out);
    return {
      performed: true,
      path: rel,
      background_removed: keyed,
      upscaled: (meta.width || 0) < target,
      final_format: "png",
    };
  } catch (error) {
    return { performed: false, reason: "remaster-error", message: String(error?.message || error).slice(0, 160) };
  }
}
