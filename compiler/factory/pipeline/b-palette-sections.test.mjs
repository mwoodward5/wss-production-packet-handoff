import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BUSINESS_TYPE_PAIRS,
  build,
  colorContrastRatio,
  dedupeLocationLabels,
  resetBusinessTypePairMemory,
  resolveBusinessPalette,
  resolveSectionPlan,
  sanitizeBusinessLocation,
  selectBusinessTypography,
} from "./05-build-v8.mjs";
import { checkBrandPaletteUse } from "../../qc-audit/qc.mjs";

const LIGHT_PALETTE = {
  mode: "light",
  background: "#F7F5EE",
  surface: "#FFFFFF",
  ink: "#18201E",
  muted: "#62605B",
  accent: "#B4552D",
  accentAlt: "#41604F",
};

test("business palettes add slug entropy and preserve contrast", () => {
  const first = resolveBusinessPalette({
    packet: { slug: "roofing-alpha" },
    compositionPalette: LIGHT_PALETTE,
    seedInt: 101,
  });
  const second = resolveBusinessPalette({
    packet: { slug: "roofing-beta" },
    compositionPalette: LIGHT_PALETTE,
    seedInt: 202,
  });

  assert.notEqual(first.signature, second.signature);
  assert.notEqual(
    [first.bg, first.accent, first.accent2].join("|"),
    [second.bg, second.accent, second.accent2].join("|"),
  );
  assert.ok(colorContrastRatio(first.accent, first.bg) >= 4.5);
  assert.ok(colorContrastRatio(second.accent, second.bg) >= 4.5);
});

test("discovered brand colors beat trade defaults and unsafe colors are corrected", () => {
  const branded = resolveBusinessPalette({
    packet: {},
    discoveredBrand: { colors: ["#005A9C", "#8A2BE2"] },
    compositionPalette: LIGHT_PALETTE,
    seedInt: 17,
  });
  const lowContrast = resolveBusinessPalette({
    packet: {},
    discoveredBrand: { colors: ["#FAF9F0"] },
    compositionPalette: LIGHT_PALETTE,
    seedInt: 18,
  });

  assert.equal(branded.source, "discovered-brand");
  assert.deepEqual(branded.brandColors, ["#005A9C", "#8A2BE2"]);
  assert.ok(["#005A9C", "#8A2BE2"].includes(branded.accent));
  assert.ok(colorContrastRatio(lowContrast.accent, lowContrast.bg) >= 4.5);
  assert.notEqual(lowContrast.accent, "#FAF9F0");
});

test("neutral-leading source palettes visibly bind two chromatic brand accents", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-b-brand-accents-"));
  const brandColors = ["#5E5E5E", "#0074DB", "#002768", "#8C0909", "#F9F9F9"];
  writeFileSync(path.join(outDir, "brand.json"), JSON.stringify({
    name: "Signature Landscape",
    colors: brandColors,
  }));
  const packet = {
    slug: "b8-signature-landscape",
    batch_id: "b8-brand-palette-regression",
    forge: { demo: true },
    build_type: "single-page-cinematic",
    business: {
      name: "Signature Landscape",
      category: "landscaping",
      city: "Mission Viejo",
      state: "CA",
      address: "25862 Jamon Ln, Mission Viejo, CA 92691",
    },
    services: ["Landscape design", "Hardscaping", "Outdoor living"],
    enrichment_sources: {
      address: {
        source: "source-packet",
        confidence: 0.99,
        value: "25862 Jamon Ln, Mission Viejo, CA 92691",
      },
      latlng: {
        source: "source-packet",
        confidence: 0.99,
        value: { lat: 33.586520990725, lng: -117.665384967618 },
      },
    },
  };

  try {
    await build(packet, { outDir, capture: false });
    const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
    const brandGate = checkBrandPaletteUse(outDir);

    assert.deepEqual(publicPacket.visual_system.resolved.brand_colors, brandColors);
    assert.equal(brandGate.pass, true, brandGate.detail);
    assert.deepEqual(brandGate.extracted_brand_colors, ["#0074db", "#002768", "#8c0909"]);
    assert.equal(brandGate.matched_brand_colors.length, 2);
    assert.deepEqual([...brandGate.visibly_used_tokens].sort(), ["accent", "accent2"]);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("font pool has twenty options and direct fallback is deterministic", () => {
  resetBusinessTypePairMemory();
  assert.ok(BUSINESS_TYPE_PAIRS.length >= 16);
  assert.equal(new Set(BUSINESS_TYPE_PAIRS.map((pair) => pair.id)).size, BUSINESS_TYPE_PAIRS.length);

  const packet = { batch_id: "roofing-proof-batch" };
  const first = selectBusinessTypography(packet, 42);
  const second = selectBusinessTypography(packet, 42);
  assert.equal(first.id, second.id);
  assert.equal(selectBusinessTypography({}, 42).id, first.id);
});

test("stage-four section plans produce real, ordered renderer sections", () => {
  const galleryFirst = resolveSectionPlan([
    "hero",
    "before-after-slider",
    "homeowner-configurator",
    "process-timeline",
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ]);
  const mapFirst = resolveSectionPlan([
    "hero",
    "service-map",
    "material-swatch-lab",
    "team-portrait",
    "trust-ledger",
    "faq-speakable",
    "contact-strip-map",
  ]);

  assert.deepEqual(galleryFirst.slice(0, 3), ["gallery", "services", "process"]);
  assert.deepEqual(mapFirst.slice(0, 3), ["map", "materials", "founder"]);
  assert.notDeepEqual(galleryFirst, mapFirst);
  assert.ok(galleryFirst.length >= 6);
  assert.ok(mapFirst.length >= 6);
});

test("location sanitizer rejects state-as-city and deduplicates area labels", () => {
  const location = sanitizeBusinessLocation({
    business: {
      city: "CA",
      state: "CA",
      address: "1640 North First Street, Fresno, CA 93703",
    },
  });
  const areas = dedupeLocationLabels([
    "Fresno, CA - Pima County - Fresno, CA",
    "",
    "Fresno, CA",
  ], location);

  assert.deepEqual(location, { city: "Fresno", state: "CA", label: "Fresno, CA" });
  assert.deepEqual(areas, ["Fresno, CA", "Pima County"]);
});

test("build consumes brand.json, section_plan, coordinates, and emits design evidence", async () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-b-palette-"));
  writeFileSync(path.join(outDir, "brand.json"), JSON.stringify({
    name: "Signal Roofing",
    colors: ["#005A9C", "#8A2BE2"],
  }));
  const packet = {
    slug: "signal-roofing-fresno",
    batch_id: "roofing-integration",
    forge: { demo: true },
    build_type: "single-page",
    business: {
      name: "Signal Roofing",
      category: "roofing",
      city: "CA",
      state: "CA",
      address: "1640 North First Street, Fresno, CA 93703",
    },
    services: ["Roof replacement", "Roof repair", "Roof inspection"],
    section_plan: [
      "hero",
      "service-map",
      "material-swatch-lab",
      "team-portrait",
      "trust-ledger",
      "faq-speakable",
      "contact-strip-map",
    ],
    enrichment_sources: {
      address: {
        source: "google-places",
        confidence: 0.98,
        value: "1640 North First Street, Fresno, CA 93703",
      },
      latlng: {
        source: "google-places",
        confidence: 0.98,
        value: { lat: 36.7612, lng: -119.7714 },
      },
      place_id: {
        source: "google-places",
        confidence: 0.98,
        value: "ChIJ-siteforge-proof",
      },
    },
  };

  try {
    await build(packet, { outDir, capture: false });
    const html = readFileSync(path.join(outDir, "index.html"), "utf8");
    const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));

    assert.match(html, /data-palette-source="discovered-brand"/);
    assert.match(html, /data-design-signature="ds1-[a-f0-9]{20}"/);
    assert.match(html, /data-palette-signature="[a-f0-9]{16}"/);
    assert.match(html, /data-font-pair="[a-z0-9-]+"/);
    assert.match(html, /data-section-sequence="map\|founder\|trust-strip\|faq\|cta"/);
    assert.match(html, /data-google-map="satellite"/);
    assert.match(html, /data-map-accent="#[A-F0-9]{6}"/);
    assert.match(html, /data-map data-accent="#[A-F0-9]{6}" data-label="Signal Roofing" data-google-map="satellite"/);
    assert.match(html, /className='map-marker'/);
    assert.match(html, /data-map-rendered','exact-coordinate-pin'/);
    assert.match(html, /\.premier-map\[data-map\]\.map-live \.ml-holder\{opacity:1;pointer-events:auto\}/);
    assert.match(html, /\.premier-map\[data-map\] \.premier-map__directions\{[^}]*border-top:3px solid var\(--accent\)/);
    assert.doesNotMatch(html, /premier-map__brand-pin/);
    assert.match(html, /"@type":"GeoCoordinates"/);
    assert.doesNotMatch(html, /\bCA,\s*CA\b/);
    assert.equal(publicPacket.visual_system.resolved.palette_source, "discovered-brand");
    assert.deepEqual(publicPacket.visual_system.resolved.brand_colors, ["#005A9C", "#8A2BE2"]);
    assert.equal(publicPacket.business.city, "Fresno");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("three same-trade businesses emit collision-free design signatures", async () => {
  resetBusinessTypePairMemory();
  const fixtures = [
    {
      slug: "signal-roofing-fresno",
      name: "Signal Roofing",
      city: "Fresno",
      colors: ["#005A9C", "#8A2BE2"],
      lat: 36.7612,
      lng: -119.7714,
      plan: ["hero", "service-map", "material-swatch-lab", "team-portrait", "trust-ledger", "faq-speakable", "contact-strip-map"],
    },
    {
      slug: "forge-roofing-bakersfield",
      name: "Forge Roofing",
      city: "Bakersfield",
      colors: ["#8B1E3F", "#0B6E4F"],
      lat: 35.3733,
      lng: -119.0187,
      plan: ["hero", "before-after-slider", "homeowner-configurator", "process-timeline", "trust-ledger", "faq-speakable", "contact-strip-map"],
    },
    {
      slug: "summit-roofing-sacramento",
      name: "Summit Roofing",
      city: "Sacramento",
      colors: ["#7A3E00", "#244B7A"],
      lat: 38.5816,
      lng: -121.4944,
      plan: ["hero", "homeowner-configurator", "journal-excerpt", "material-swatch-lab", "trust-ledger", "process-timeline", "faq-speakable", "contact-strip-map"],
    },
  ];
  const roots = [];
  const signatures = [];
  const paletteSignatures = [];
  const fontPairs = [];
  const sectionOrders = [];

  try {
    for (const fixture of fixtures) {
      const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-roofing-signature-"));
      roots.push(outDir);
      writeFileSync(path.join(outDir, "brand.json"), JSON.stringify({
        name: fixture.name,
        colors: fixture.colors,
      }));
      const address = `100 Main Street, ${fixture.city}, CA 90000`;
      const packet = {
        slug: fixture.slug,
        batch_id: "same-trade-collision-proof",
        forge: { demo: true },
        build_type: "single-page",
        business: {
          name: fixture.name,
          category: "roofing",
          city: fixture.city,
          state: "CA",
          address,
        },
        services: ["Roof replacement", "Roof repair", "Roof inspection"],
        section_plan: fixture.plan,
        enrichment_sources: {
          address: { source: "google-places", confidence: 0.98, value: address },
          latlng: {
            source: "google-places",
            confidence: 0.98,
            value: { lat: fixture.lat, lng: fixture.lng },
          },
        },
      };

      await build(packet, { outDir, capture: false });
      const publicPacket = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
      const resolved = publicPacket.visual_system.resolved;
      const signature = resolved.design_signature.id;
      signatures.push(signature);
      paletteSignatures.push(resolved.palette_signature);
      fontPairs.push(resolved.font_pair_id);
      sectionOrders.push(resolved.section_order.join("|"));
      assert.deepEqual(resolved.brand_colors, fixture.colors);
    }

    assert.equal(new Set(signatures).size, 3);
    assert.equal(new Set(paletteSignatures).size, 3);
    assert.equal(new Set(fontPairs).size, 3);
    assert.equal(new Set(sectionOrders).size, 3);
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
