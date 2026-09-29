import {
  hasUsableContainedSourceDimensions,
  isBoundContainedSourceProof,
} from "../../factory/lib/media-intelligence.mjs";

const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_MAX_BYTES = 384 * 1024;

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifDimensions(buffer) {
  if (buffer.length < 10 || !/^GIF8/.test(buffer.toString("ascii", 0, 4))) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (offset + 7 >= buffer.length) return null;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    if (offset + 1 >= buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (!length) return null;
    offset += length;
  }
  return null;
}

function webpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

function svgDimensions(buffer) {
  const source = buffer.toString("utf8", 0, Math.min(buffer.length, 4096));
  const width = source.match(/\bwidth=["']?([0-9.]+)/i)?.[1];
  const height = source.match(/\bheight=["']?([0-9.]+)/i)?.[1];
  if (width && height) return { width: Number(width), height: Number(height) };
  const viewBox = source.match(/\bviewBox=["'][^"']*?\s([0-9.]+)\s+([0-9.]+)["']/i);
  return viewBox ? { width: Number(viewBox[1]), height: Number(viewBox[2]) } : null;
}

export function imageDimensions(buffer, contentType = "") {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || []);
  const type = String(contentType).toLowerCase().split(";", 1)[0];
  if (type === "image/png") return pngDimensions(buffer);
  if (type === "image/jpeg" || type === "image/jpg") return jpegDimensions(buffer);
  if (type === "image/webp") return webpDimensions(buffer);
  if (type === "image/gif") return gifDimensions(buffer);
  if (type === "image/svg+xml") return svgDimensions(buffer);
  return pngDimensions(buffer) || jpegDimensions(buffer) || webpDimensions(buffer) || gifDimensions(buffer) || svgDimensions(buffer);
}

async function readLimitedBody(response, maxBytes) {
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer()).subarray(0, maxBytes);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - total;
      chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
      total += Math.min(chunk.length, remaining);
    }
  } finally {
    if (total >= maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks, total);
}

export async function probeRemoteImage(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Range: `bytes=0-${maxBytes - 1}`,
        "User-Agent": "Mozilla/5.0 (compatible; SiteForgeMediaProbe/8.0)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 206) return null;
    const contentType = String(response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
    if (contentType && !contentType.startsWith("image/")) return null;
    const buffer = await readLimitedBody(response, maxBytes);
    const dimensions = imageDimensions(buffer, contentType);
    if (!dimensions?.width || !dimensions?.height) return null;
    return {
      ...dimensions,
      bytes_sampled: buffer.length,
      content_type: contentType || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichRemoteImageAssets(assets = [], options = {}) {
  const limit = Math.max(0, Number(options.limit || 24));
  const concurrency = Math.max(1, Math.min(8, Number(options.concurrency || 4)));
  const pending = assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset?.kind === "photo" && /^https?:\/\//i.test(asset.url || "") && !asset.meta?.dimensions?.width && !asset.meta?.width)
    .slice(0, limit);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (cursor < pending.length) {
      const current = pending[cursor++];
      const result = await probeRemoteImage(current.asset.url, options);
      if (!result) continue;
      const normalPhotoEligible = result.width * result.height >= 300_000
        && Math.max(result.width, result.height) >= 640
        && Math.min(result.width, result.height) >= 320;
      const containedSourceEligible = !normalPhotoEligible
        && hasUsableContainedSourceDimensions(result.width, result.height)
        && isBoundContainedSourceProof({
          ...current.asset,
          hero_eligible: false,
          proof_eligible: true,
          meta: {
            ...(current.asset.meta || {}),
            contained_source: true,
            display_policy: "contained-source-proof",
          },
        });
      const fallbackToAmbiance = !normalPhotoEligible && !containedSourceEligible;
      current.asset.meta = {
        ...(current.asset.meta || {}),
        dimensions: { width: result.width, height: result.height },
        width: result.width,
        height: result.height,
        source_width: result.width,
        source_height: result.height,
        content_type: result.content_type,
        quality_status: containedSourceEligible ? "contained_source_proof" : fallbackToAmbiance ? "ambiance_fallback" : "usable",
        fallback_to_ambiance: fallbackToAmbiance,
        ...(containedSourceEligible ? {
          contained_source: true,
          display_policy: "contained-source-proof",
        } : {}),
      };
      current.asset.hero_eligible = normalPhotoEligible;
      current.asset.proof_eligible = normalPhotoEligible || containedSourceEligible;
    }
  });
  await Promise.all(workers);
  return assets;
}
