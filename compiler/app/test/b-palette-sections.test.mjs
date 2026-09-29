import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { build, resolveBusinessPalette } from "../../factory/pipeline/05-build-v8.mjs";
import { checkBrandPaletteUse } from "../../qc-audit/qc.mjs";

const VERIFIED_LOGO_SHA256 = "a".repeat(64);
const verifiedLogoColorProof = {
  verified: true,
  method: "staged-logo-pixel-extraction-v1",
  content_sha256: VERIFIED_LOGO_SHA256,
};

test("Firecrawl semantic branding colors feed the discovered business palette", () => {
  const palette = resolveBusinessPalette({
    packet: {
      enrichment_sources: {
        branding: {
          value: {
            colors: {
              primary: "#005a9c",
              secondary: { hex: "#8a2be2" },
              accent: { value: ["#cc5500"] },
            },
          },
        },
      },
    },
    compositionPalette: {
      mode: "light",
      background: "#F7F5EE",
      surface: "#FFFFFF",
      ink: "#18201E",
      muted: "#62605B",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    seedInt: 17,
  });

  assert.equal(palette.source, "discovered-brand");
  assert.deepEqual(palette.brandColors, ["#005A9C", "#8A2BE2", "#CC5500"]);
});

test("verified red and black logo colors outrank conflicting page colors by role", () => {
  const light = resolveBusinessPalette({
    packet: {
      logo_source: {
        url: "media/logo.png",
        origin: "upload",
        proposed: false,
        colors: ["#D71920", "#101010"],
        color_provenance: verifiedLogoColorProof,
        meta: { checksum_sha256: VERIFIED_LOGO_SHA256 },
      },
      brand: { colors: ["#005A9C", "#2E8B57"] },
    },
    discoveredBrand: { colors: ["#005A9C", "#2E8B57"] },
    compositionPalette: {
      mode: "light",
      background: "#F7F5EE",
      surface: "#FFFFFF",
      ink: "#18201E",
      muted: "#62605B",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    seedInt: 17,
  });
  assert.deepEqual(light.verifiedLogoColors, ["#D71920", "#101010"]);
  assert.deepEqual(light.accentBrandColors, ["#D71920"]);
  assert.equal(light.darkIdentityNeutral, "#101010");
  assert.equal(light.ink, "#101010");

  const dark = resolveBusinessPalette({
    packet: {
      logo_source: {
        url: "media/logo.png",
        origin: "upload",
        proposed: false,
        colors: ["#D71920", "#101010"],
        color_provenance: verifiedLogoColorProof,
        meta: { checksum_sha256: VERIFIED_LOGO_SHA256 },
      },
      brand: { colors: ["#005A9C", "#2E8B57"] },
    },
    compositionPalette: {
      mode: "dark",
      background: "#17191E",
      surface: "#1F2228",
      ink: "#F7F5EF",
      muted: "#B9B7B0",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    seedInt: 17,
  });
  assert.deepEqual(dark.verifiedLogoColors, ["#D71920", "#101010"]);
  assert.equal(dark.darkIdentityNeutral, "#101010");
  assert.equal(dark.bg, "#121212");
});

test("generated and proposed logo metadata cannot outrank page colors in the renderer", () => {
  const variants = [
    { origin: "generated", proposed: false },
    { origin: "upload", proposed: true },
    { origin: "upload", proposed: false, generated: true },
    { origin: "upload", proposed: false, ai_generated: true },
  ];
  for (const metadata of variants) {
    const palette = resolveBusinessPalette({
      packet: {
        logo_source: {
          url: "media/logo.png",
          ...metadata,
          colors: ["#D71920", "#101010"],
          color_provenance: verifiedLogoColorProof,
          meta: { checksum_sha256: VERIFIED_LOGO_SHA256 },
        },
        brand: { colors: ["#005A9C", "#2E8B57"] },
      },
      discoveredBrand: { colors: ["#005A9C", "#2E8B57"] },
      compositionPalette: {
        mode: "light",
        background: "#F7F5EE",
        surface: "#FFFFFF",
        ink: "#18201E",
        muted: "#62605B",
        accent: "#B4552D",
        accentAlt: "#41604F",
      },
      seedInt: 17,
    });
    assert.deepEqual(palette.verifiedLogoColors, [], JSON.stringify(metadata));
    assert.deepEqual(palette.brandColors, ["#005A9C", "#2E8B57"], JSON.stringify(metadata));
    assert.deepEqual(palette.accentBrandColors, ["#005A9C", "#2E8B57"], JSON.stringify(metadata));
  }
});

test("forged top-level logo hash cannot override a mismatching staged asset hash", () => {
  const palette = resolveBusinessPalette({
    packet: {
      logo_source: {
        url: "media/logo.png",
        origin: "upload",
        proposed: false,
        colors: ["#FF00FF"],
        color_provenance: verifiedLogoColorProof,
        checksum_sha256: VERIFIED_LOGO_SHA256,
        content_sha256: VERIFIED_LOGO_SHA256,
        meta: { checksum_sha256: "b".repeat(64) },
      },
      brand: { colors: ["#005A9C", "#2E8B57"] },
    },
    discoveredBrand: { colors: ["#005A9C", "#2E8B57"] },
    compositionPalette: {
      mode: "light",
      background: "#F7F5EE",
      surface: "#FFFFFF",
      ink: "#18201E",
      muted: "#62605B",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    seedInt: 17,
  });
  assert.deepEqual(palette.verifiedLogoColors, []);
  assert.deepEqual(palette.accentBrandColors, ["#005A9C", "#2E8B57"]);
});

test("brand palette QC prefers verified logo colors over page discovery colors", (t) => {
  const siteDir = mkdtempSync(path.join(tmpdir(), "siteforge-logo-palette-qc-"));
  t.after(() => rmSync(siteDir, { recursive: true, force: true }));
  const logoBytes = Buffer.from("verified-logo-pixel-fixture");
  const logoSha256 = createHash("sha256").update(logoBytes).digest("hex");
  mkdirSync(path.join(siteDir, "media"), { recursive: true });
  writeFileSync(path.join(siteDir, "media", "logo.png"), logoBytes);
  writeFileSync(path.join(siteDir, "packet.json"), JSON.stringify({
    logo_source: {
      url: "media/logo.png",
      origin: "upload",
      proposed: false,
      colors: ["#D71920", "#101010"],
      color_provenance: {
        ...verifiedLogoColorProof,
        content_sha256: logoSha256,
      },
      asset_identity: {
        sha256: logoSha256,
        method: "content-sha256",
      },
    },
    brand: { colors: ["#005A9C", "#2E8B57"] },
  }));
  writeFileSync(path.join(siteDir, "index.html"), `<!doctype html><style>
    :root{--accent:#005A9C;--accent2:#2E8B57;--brand:#005A9C;--brand-2:#2E8B57;--ink:#18201E;--bg:#F7F5EE;--panel:#FFFFFF}
    body{color:var(--ink);background:var(--bg)}
    .identity{color:var(--accent);border-color:var(--brand);background:var(--panel)}
  </style><main class="identity">Example</main>`);

  const result = checkBrandPaletteUse(siteDir);
  assert.equal(result.pass, false, result.detail);
  assert.deepEqual(result.verified_logo_colors, ["#d71920", "#101010"]);
  assert.deepEqual(result.matched_brand_colors, []);
  assert.deepEqual(result.matched_dark_logo_neutrals, ["#101010"]);
});

test("generated and proposed logo colors cannot outrank page palette evidence in QC", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "siteforge-untrusted-logo-palette-qc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const variants = [
    { origin: "generated", proposed: false },
    { origin: "upload", proposed: true },
  ];

  for (const [index, metadata] of variants.entries()) {
    const siteDir = path.join(root, String(index));
    mkdirSync(siteDir, { recursive: true });
    writeFileSync(path.join(siteDir, "packet.json"), JSON.stringify({
      logo_source: {
        url: "media/logo.png",
        ...metadata,
        colors: ["#D71920", "#101010"],
        color_provenance: verifiedLogoColorProof,
        asset_identity: {
          sha256: VERIFIED_LOGO_SHA256,
          method: "content-sha256",
        },
      },
      brand: { colors: ["#005A9C", "#2E8B57"] },
      source: { brandColors: ["#005A9C", "#2E8B57"] },
    }));
    writeFileSync(path.join(siteDir, "index.html"), `<!doctype html><style>
      :root{--accent:#005A9C;--accent2:#2E8B57;--brand:#005A9C;--brand-2:#2E8B57;--ink:#18201E;--bg:#F7F5EE;--panel:#FFFFFF}
      body{color:var(--ink);background:var(--bg)}
      .identity{color:var(--accent);border:4px solid var(--accent2);background:var(--panel)}
    </style><main class="identity">Example</main>`);

    const result = checkBrandPaletteUse(siteDir);
    assert.equal(result.pass, true, `${JSON.stringify(metadata)}: ${result.detail}`);
    assert.deepEqual(result.verified_logo_colors, []);
    assert.deepEqual(result.extracted_brand_colors, ["#005a9c", "#2e8b57"]);
  }
});

test("uploaded logo metadata without matching pixel and asset identity proof cannot override or pass QC", (t) => {
  const palette = resolveBusinessPalette({
    packet: {
      logo_source: {
        url: "media/missing.png",
        origin: "upload",
        proposed: false,
        colors: ["#FF00FF"],
      },
      brand: { colors: ["#005A9C", "#2E8B57"] },
    },
    discoveredBrand: { colors: ["#005A9C", "#2E8B57"] },
    compositionPalette: {
      mode: "light",
      background: "#F7F5EE",
      surface: "#FFFFFF",
      ink: "#18201E",
      muted: "#62605B",
      accent: "#B4552D",
      accentAlt: "#41604F",
    },
    seedInt: 17,
  });
  assert.deepEqual(palette.verifiedLogoColors, []);
  assert.deepEqual(palette.accentBrandColors, ["#005A9C", "#2E8B57"]);

  const siteDir = mkdtempSync(path.join(tmpdir(), "siteforge-missing-logo-palette-qc-"));
  t.after(() => rmSync(siteDir, { recursive: true, force: true }));
  writeFileSync(path.join(siteDir, "packet.json"), JSON.stringify({
    logo_source: {
      url: "media/missing.png",
      source: "owner-provided",
      proposed: false,
      colors: ["#FF00FF"],
      color_provenance: verifiedLogoColorProof,
      asset_identity: {
        sha256: VERIFIED_LOGO_SHA256,
        method: "content-sha256",
      },
    },
  }));
  writeFileSync(path.join(siteDir, "index.html"), `<!doctype html><style>
    :root{--accent:#FF00FF;--ink:#181818;--bg:#F7F5EE;--panel:#FFFFFF}
    body{color:var(--ink);background:var(--bg)}
    .identity{color:var(--accent);background:var(--panel)}
  </style><main class="identity">Example</main>`);
  const result = checkBrandPaletteUse(siteDir);
  assert.equal(result.pass, false, result.detail);
  assert.deepEqual(result.verified_logo_colors, []);
});

test("neutral discovery colors do not displace two materially rendered brand colors", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-brand-palette-use-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));

  await build({
    slug: "neutral-first-brand-proof",
    forge: { demo: true },
    business: {
      name: "Example Service Company",
      category: "plumbing",
      city: "Austin",
      state: "TX",
    },
    services: ["Drain Cleaning"],
    brand: {
      colors: ["#FFFFFF", "#000000", "#005A9C", "#E63B26"],
    },
    media: { catalog: [] },
    enrichment_sources: {},
  }, { outDir, capture: false });

  const result = checkBrandPaletteUse(outDir);
  assert.equal(result.pass, true, result.detail);
  assert.deepEqual(result.matched_brand_colors, ["#005a9c", "#e63b26"]);
});

test("a pale secondary brand color remains materially visible after contrast-safe accent mapping", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-pale-brand-palette-use-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));

  await build({
    slug: "pale-secondary-brand-proof",
    forge: { demo: true },
    business: {
      name: "Example Service Company",
      category: "plumbing",
      city: "Killeen",
      state: "TX",
    },
    services: ["Drain Cleaning"],
    brand: {
      colors: ["#0000EE", "#FCDADA", "#FDECEC", "#FFFFFF", "#000000"],
    },
    media: { catalog: [] },
    enrichment_sources: {},
  }, { outDir, capture: false });

  const result = checkBrandPaletteUse(outDir);
  assert.equal(result.pass, true, result.detail);
  assert.ok(result.matched_brand_colors.includes("#0000ee"));
  assert.ok(result.matched_brand_colors.includes("#fcdada"));
});
