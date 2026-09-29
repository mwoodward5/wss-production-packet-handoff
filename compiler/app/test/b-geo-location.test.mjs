import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyDiscoveryBrandColors,
  explicitTemplateFamily,
  normalizeBusinessLocation,
  writeDiscoveryPackets,
} from "../lib/engine-adapter.mjs";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(APP_ROOT, "..");

function runForge(footprint, slug) {
  const workDir = mkdtempSync(path.join(tmpdir(), "siteforge-b-geo-"));
  const footprintFile = path.join(workDir, "footprint.json");
  const packetFile = path.join(ROOT, "packets", `${slug}.json`);
  writeFileSync(footprintFile, JSON.stringify(footprint));
  try {
    const result = spawnSync(process.execPath, [
      path.join(ROOT, "scripts", "forge.mjs"),
      "--prompt",
      "Site for Atlas Roofing in CA, CA. A roofing business.",
      "--footprint",
      footprintFile,
      "--slug",
      slug,
      "--dry-run",
      "--json",
    ], { cwd: ROOT, encoding: "utf8" });
    const jsonStart = result.stdout.indexOf("{");
    return {
      ...result,
      packet: jsonStart >= 0 ? JSON.parse(result.stdout.slice(jsonStart)) : null,
    };
  } finally {
    rmSync(packetFile, { force: true });
    rmSync(workDir, { recursive: true, force: true });
  }
}

test("LeadMiner footprint geo, place ID, address fallback, and brand colors reach the packet", () => {
  const result = runForge({
    business: {
      name: "Atlas Roofing",
      category: "roofing",
      city: "CA",
      state: "CA",
      address: "411 Mission Inn Ave, Riverside, CA 92501",
    },
    geometry: { location: { lat: 33.9806, lng: -117.3755 } },
    place_id: "ChIJ-atlas-roofing",
    brand: { colors: ["#1a2b3c", "#D45522", "not-a-color", "#1A2B3C"] },
  }, `b-geo-${process.pid}-complete`);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.packet.business.city, "Riverside");
  assert.equal(result.packet.business.state, "CA");
  assert.equal(result.packet.business.address, "411 Mission Inn Ave, Riverside, CA 92501");
  assert.deepEqual(result.packet.business.latlng, { lat: 33.9806, lng: -117.3755 });
  assert.equal(result.packet.business.place_id, "ChIJ-atlas-roofing");
  assert.deepEqual(result.packet.enrichment_sources.latlng.value, { lat: 33.9806, lng: -117.3755 });
  assert.equal(result.packet.enrichment_sources.map_id.value, "ChIJ-atlas-roofing");
  assert.equal(result.packet.gbp.pid, "ChIJ-atlas-roofing");
  assert.deepEqual(result.packet.source.brandColors, ["#1A2B3C", "#D45522"]);
  assert.deepEqual(result.packet.brand.colors, ["#1A2B3C", "#D45522"]);
});

test("malformed duplicate location hints fail closed when no real address can recover them", () => {
  const result = runForge({
    business: {
      name: "Atlas Roofing",
      category: "roofing",
      city: "CA, CA",
      state: "CA",
    },
  }, `b-geo-${process.pid}-invalid`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required business facts: city/i);
  assert.equal(result.packet, null);
});

test("app location sanitizer uses a sourced address and rejects duplicate state tokens", () => {
  assert.deepEqual(normalizeBusinessLocation({
    city: "CA, CA",
    state: "CA",
    address: "411 Mission Inn Ave, Riverside, CA 92501",
  }), { city: "Riverside", state: "CA" });
  assert.deepEqual(normalizeBusinessLocation({
    city: "Riverside, Riverside, CA",
    state: "CA",
  }), { city: "Riverside", state: "CA" });
  assert.deepEqual(normalizeBusinessLocation({ city: "CA", state: "CA" }), { city: "", state: "CA" });
});

test("renderer brand inputs contain only source-derived valid discovery colors", () => {
  const packet = { enrichment_sources: {} };
  assert.deepEqual(applyDiscoveryBrandColors(packet, {
    brand: { colors: ["#112233", "#AABBCC", "transparent", "#112233"] },
  }), ["#112233", "#AABBCC"]);
  assert.deepEqual(packet.brand.colors, ["#112233", "#AABBCC"]);
  assert.deepEqual(packet.source.brandColors, ["#112233", "#AABBCC"]);

  const emptyPacket = { enrichment_sources: {} };
  assert.deepEqual(applyDiscoveryBrandColors(emptyPacket, { brand: { colors: ["blue"] } }), []);
  assert.equal(emptyPacket.brand, undefined);
  assert.equal(emptyPacket.source, undefined);
});

test("discovery packet persists source colors for the next build context", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "siteforge-brand-contract-"));
  try {
    writeDiscoveryPackets(dir, {
      business: { name: "Atlas Roofing" },
      enrichment_sources: {},
      voice_persona: { tone: "direct" },
      source: { brandColors: ["#224466", "#CC5500"] },
    }, []);
    const brand = JSON.parse(readFileSync(path.join(dir, "brand.json"), "utf8"));
    assert.deepEqual(brand.colors, ["#224466", "#CC5500"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an inferred source family does not pin the hero, while an explicit template does", () => {
  assert.equal(explicitTemplateFamily({
    family: "service-map-pins",
    source: { facts: { category: "roofing" } },
  }), null);
  assert.equal(explicitTemplateFamily({
    family: "service-map-pins",
    template: { id: "template-1", hero_family: "service-map-pins" },
    source: { facts: { category: "roofing" } },
  }), "service-map-pins");
  assert.equal(explicitTemplateFamily({ family: "service-map-pins" }), "service-map-pins");
});
