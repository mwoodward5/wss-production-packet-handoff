import assert from "node:assert/strict";
import test from "node:test";
import { enrichRemoteImageAssets, imageDimensions, probeRemoteImage } from "../lib/image-metadata.mjs";

function png(width, height) {
  const buffer = Buffer.alloc(32);
  buffer.write("\x89PNG\r\n\x1a\n", 0, "binary");
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

test("reads PNG dimensions from a bounded source sample", () => {
  assert.deepEqual(imageDimensions(png(1440, 960), "image/png"), { width: 1440, height: 960 });
});

test("remote probe and enrichment mark tiny photos as ineligible", async () => {
  const fetchImpl = async (url) => new Response(url.includes("tiny") ? png(150, 136) : png(1600, 1000), {
    status: 206,
    headers: { "content-type": "image/png" },
  });
  const result = await probeRemoteImage("https://example.com/large.png", { fetchImpl });
  assert.equal(result.width, 1600);
  const assets = [
    { kind: "photo", url: "https://example.com/tiny.png", meta: {} },
    { kind: "photo", url: "https://example.com/large.png", meta: {} },
  ];
  await enrichRemoteImageAssets(assets, { fetchImpl, concurrency: 2 });
  assert.equal(assets[0].hero_eligible, false);
  assert.equal(assets[0].meta.fallback_to_ambiance, true);
  assert.equal(assets[1].hero_eligible, true);
  assert.deepEqual(assets[1].meta.dimensions, { width: 1600, height: 1000 });
});
