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

async function writeSyntheticLogo(root, name, pixels, width, height) {
  const file = path.join(root, name);
  const bytes = await sharp(pixels, {
    raw: { width, height, channels: 4 },
  }).png().toBuffer();
  writeFileSync(file, bytes);
  return file;
}

function ownedLogoPacket(file) {
  return {
    v7_logo: {
      url: file,
      local_path: file,
      source: "owner-upload",
      origin: "upload",
      proposed: false,
    },
    media: { catalog: [] },
  };
}

test("verified colored logo stores sampled pixels only as logo identity evidence", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-palette-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const width = 96;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const x = index % width;
    const color = x < 32
      ? [192, 64, 32]
      : x < 64
        ? [207, 79, 47]
        : [19, 94, 150];
    pixels[offset] = color[0];
    pixels[offset + 1] = color[1];
    pixels[offset + 2] = color[2];
    pixels[offset + 3] = 255;
  }
  const logo = await writeSyntheticLogo(root, "colored.png", pixels, width, height);
  const packet = ownedLogoPacket(logo);

  await hardenPreviewMedia(packet, { outDir });

  // The close reds share a quantization bucket. The result must still be one
  // literal source pixel, never an averaged color absent from the logo.
  assert.deepEqual(packet.logo_source.colors, ["#C04020", "#135E96"]);
  assert.equal(packet.logo_source.color_provenance.verified, true);
  assert.equal(packet.logo_source.color_provenance.method, "staged-logo-pixel-extraction-v1");
  assert.match(packet.logo_source.color_provenance.content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(packet.v7_logo.colors, undefined);
  assert.equal(packet.v7_logo.color_provenance, undefined);
  assert.deepEqual(packet.brand.colors, ["#C04020", "#135E96"]);
  assert.equal(packet.source, undefined);
  assert.equal(packet.enrichment_sources.colors, undefined);
});

test("verified logo colors outrank conflicting page discovery colors", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-palette-precedence-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const width = 96;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const red = index % width < width / 2;
    pixels[offset] = red ? 215 : 16;
    pixels[offset + 1] = red ? 25 : 16;
    pixels[offset + 2] = red ? 32 : 16;
    pixels[offset + 3] = 255;
  }
  const logo = await writeSyntheticLogo(root, "identity.png", pixels, width, height);
  const packet = {
    ...ownedLogoPacket(logo),
    brand: { colors: ["#005A9C", "#2E8B57"] },
    source: { brandColors: ["#005A9C", "#2E8B57"] },
    enrichment_sources: {
      colors: {
        source: "business-site",
        confidence: 0.8,
        value: ["#005A9C", "#2E8B57"],
      },
    },
  };

  await hardenPreviewMedia(packet, { outDir });

  assert.deepEqual(packet.logo_source.colors, ["#D71920", "#101010"]);
  assert.equal(packet.logo_source.color_provenance.verified, true);
  assert.equal(packet.logo_source.color_provenance.method, "staged-logo-pixel-extraction-v1");
  assert.match(packet.logo_source.color_provenance.content_sha256, /^[a-f0-9]{64}$/);
  assert.equal(packet.v7_logo.colors, undefined);
  assert.equal(packet.v7_logo.color_provenance, undefined);
  assert.deepEqual(packet.brand.colors, ["#D71920", "#101010", "#005A9C", "#2E8B57"]);
  assert.deepEqual(packet.source.brandColors, ["#005A9C", "#2E8B57"]);
  assert.deepEqual(packet.enrichment_sources.colors, {
    source: "business-site",
    confidence: 0.8,
    value: ["#005A9C", "#2E8B57"],
  });
});

test("generated logo candidates cannot seed or relabel page colors", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-generated-logo-palette-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4, 32);
  for (let index = 0; index < width * height; index += 1) pixels[index * 4 + 3] = 255;
  const logo = await writeSyntheticLogo(root, "generated.png", pixels, width, height);
  const pageColors = ["#005A9C", "#2E8B57"];
  const packet = {
    v7_logo: {
      url: logo,
      local_path: logo,
      source: "generated",
      origin: "ai-generated",
      proposed: false,
      colors: ["#D71920", "#101010"],
    },
    brand: { colors: [...pageColors] },
    source: { brandColors: [...pageColors] },
    enrichment_sources: {
      colors: { source: "business-site", confidence: 0.8, value: [...pageColors] },
    },
    media: { catalog: [] },
  };

  await hardenPreviewMedia(packet, { outDir });

  assert.equal(packet.logo_source, undefined);
  assert.deepEqual(packet.brand.colors, pageColors);
  assert.deepEqual(packet.source.brandColors, pageColors);
  assert.deepEqual(packet.enrichment_sources.colors, {
    source: "business-site",
    confidence: 0.8,
    value: pageColors,
  });
});

test("transparent and white-only logo pixels do not fabricate brand colors", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-white-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 16; y < 48; y += 1) {
    for (let x = 16; x < 48; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = 255;
    }
  }
  const logo = await writeSyntheticLogo(root, "white.png", pixels, width, height);
  const packet = ownedLogoPacket(logo);
  packet.v7_logo.colors = ["#D71920", "#101010"];

  await hardenPreviewMedia(packet, { outDir });

  assert.equal(packet.brand, undefined);
  assert.equal(packet.source, undefined);
  assert.equal(packet.enrichment_sources.colors, undefined);
  assert.equal(packet.logo_source.colors, undefined);
  assert.equal(packet.logo_source.color_provenance, undefined);
  assert.equal(packet.v7_logo.colors, undefined);
  assert.equal(packet.v7_logo.color_provenance, undefined);
});

test("opaque #E7E7E7 logo canvas yields the real dark monochrome mark", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-monochrome-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 4, 231);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4 + 3] = 255;
  }
  for (let y = 20; y < 44; y += 1) {
    for (let x = 20; x < 44; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 16;
      pixels[offset + 1] = 16;
      pixels[offset + 2] = 16;
    }
  }
  const logo = await writeSyntheticLogo(root, "monochrome.png", pixels, width, height);
  const packet = ownedLogoPacket(logo);

  await hardenPreviewMedia(packet, { outDir });

  assert.deepEqual(packet.brand.colors, ["#101010"]);
  assert.deepEqual(packet.logo_source.colors, ["#101010"]);
  assert.equal(packet.source, undefined);
  assert.equal(packet.enrichment_sources.colors, undefined);
});

test("valid local SVG logo degrades to no logo without aborting media hardening", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-svg-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logo = path.join(root, "owned.svg");
  writeFileSync(logo, [
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" viewBox="0 0 64 32">',
    '<rect width="64" height="32" fill="#173A64"/>',
    '<circle cx="16" cy="16" r="8" fill="#D9485F"/>',
    "</svg>",
  ].join(""));
  const packet = ownedLogoPacket(logo);

  await assert.doesNotReject(() => hardenPreviewMedia(packet, { outDir }));

  assert.equal(packet.v7_logo, undefined);
  assert.equal(packet.logo_source, undefined);
  assert.equal(packet.enrichment_sources?.logo, undefined);
  assert.deepEqual(packet.media.catalog, []);
});

test("valid local animated GIF logo degrades to no logo without aborting media hardening", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-gif-"));
  const outDir = path.join(root, "output");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const header = Buffer.from("47494638396101000100800000000000ffffff", "hex");
  const control = Buffer.from("21f904000a000000", "hex");
  const blackFrame = Buffer.from("2c0000000001000100000202440100", "hex");
  const whiteFrame = Buffer.from("2c00000000010001000002024c0100", "hex");
  const seed = Buffer.concat([header, control, blackFrame, control, whiteFrame, Buffer.from("3b", "hex")]);
  const bytes = await sharp(seed, { animated: true }).resize(32, 32).gif({ reuse: true }).toBuffer();
  const metadata = await sharp(bytes, { animated: true }).metadata();
  assert.equal(metadata.pages, 2);
  assert.equal(metadata.pageHeight, 32);
  const logo = path.join(root, "owned.gif");
  writeFileSync(logo, bytes);
  const packet = ownedLogoPacket(logo);

  await assert.doesNotReject(() => hardenPreviewMedia(packet, { outDir }));

  assert.equal(packet.v7_logo, undefined);
  assert.equal(packet.logo_source, undefined);
  assert.equal(packet.enrichment_sources?.logo, undefined);
  assert.deepEqual(packet.media.catalog, []);
});

test("logo color decode failure is nonfatal and returns no invented fallback", async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-logo-corrupt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "corrupt.png");
  writeFileSync(file, Buffer.from("not an image"));

  await assert.doesNotReject(async () => {
    assert.deepEqual(await extractLogoBrandColors(file), []);
  });
});
