import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  extractLogoBrandColors,
  hardenPreviewMedia,
} from "../lib/engine-adapter.mjs";

const TWO_FRAME_GIF = Buffer.from(
  "R0lGODlhIAAQAIAAAIXHiIU6iCH/C05FVFNDQVBFMi4wAwEAAAAh+QQEMgAAACwAAAAAIAAQAAACRoxvoKvox15iS7pos968+w+GFhA0ULWZ0JmwmdoiqBuX42XLq46X5D/JSUjClglILOKSSiBveNMxhdNp0HeFFbXBqnIIKAAAIfkEBTIAAgAsBgAAAAQABwAAAgkEJIbB7R8QCAUAOw==",
  "base64",
);

function unownedLocalLogoPacket(file, url) {
  return {
    v7_logo: {
      url,
      local_path: file,
      source: "business-site",
      origin: "business-site",
      proposed: false,
    },
    enrichment_sources: {
      logo: {
        source: "business-site",
        confidence: 0.9,
        value: url,
      },
    },
    media: { catalog: [] },
  };
}

test("opaque off-white canvas does not outrank the real dark monochrome mark", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-neutral-adversarial-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    pixels[offset] = 231;
    pixels[offset + 1] = 231;
    pixels[offset + 2] = 231;
    pixels[offset + 3] = 255;
  }
  for (let y = 20; y < 44; y += 1) {
    for (let x = 20; x < 44; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 16;
      pixels[offset + 1] = 16;
      pixels[offset + 2] = 16;
    }
  }
  const file = path.join(root, "off-white-monochrome.png");
  await sharp(pixels, {
    raw: { width, height, channels: 4 },
  }).png().toFile(file);

  assert.deepEqual(await extractLogoBrandColors(file), ["#101010"]);
});

for (const fixture of [
  {
    label: "SVG",
    extension: "svg",
    url: "https://business.example/assets/business-logo.svg",
    write(file) {
      writeFileSync(
        file,
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="16"><rect width="32" height="16" fill="#173F5F"/></svg>',
      );
    },
    async verify(file) {
      assert.equal((await sharp(file).metadata()).format, "svg");
    },
  },
  {
    label: "animated GIF",
    extension: "gif",
    url: "https://business.example/assets/business-logo.gif",
    write(file) {
      writeFileSync(file, TWO_FRAME_GIF);
    },
    async verify(file) {
      const metadata = await sharp(file, { animated: true }).metadata();
      assert.equal(metadata.format, "gif");
      assert.equal(metadata.pages, 2);
    },
  },
]) {
  test(`valid local ${fixture.label} candidate degrades safely to the downstream fallback`, async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-format-adversarial-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, `business-logo.${fixture.extension}`);
    fixture.write(file);
    await fixture.verify(file);
    const { label, url } = fixture;
    const packet = unownedLocalLogoPacket(file, url);
    const outDir = path.join(root, `output-${label.toLowerCase().replaceAll(" ", "-")}`);

    await assert.doesNotReject(
      () => hardenPreviewMedia(packet, {
        outDir,
        fetchImpl: async () => {
          throw new Error("Remote fallback intentionally unavailable");
        },
      }),
      `${label} candidate must not abort preview hardening`,
    );
    assert.equal(packet.v7_logo, undefined, `${label} candidate must not remain renderable`);
    assert.equal(packet.logo_source, undefined, `${label} candidate must not become the source logo`);
    assert.equal(
      packet.enrichment_sources.logo,
      undefined,
      `${label} candidate must be removed so the downstream wordmark fallback can render`,
    );
    assert.equal(packet.brand, undefined, `${label} candidate must not invent a brand palette`);
  });
}
