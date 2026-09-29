import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  build,
  normalizeServiceDisplayLabel,
} from "../../factory/pipeline/05-build-v8.mjs";

test("service display labels use acronym-safe sentence case", () => {
  const examples = new Map([
    ["WATER HEATER REPAIR", "Water heater repair"],
    ["Water Heater Repair", "Water heater repair"],
    ["same-Day Service", "Same-day service"],
    ["professional Plumbing Solutions", "Professional plumbing solutions"],
    ["HVAC Repair", "HVAC repair"],
    ["AC & Drain Cleaning", "AC & drain cleaning"],
    ["A/C Repair", "A/C repair"],
    ["HVAC/R Service", "HVAC/R service"],
    ["4K TV Installation", "4K TV installation"],
    ["R-410A Refrigerant Service", "R-410A refrigerant service"],
    ["R&D Consulting", "R&D consulting"],
    ["UV-C Air Purification", "UV-C air purification"],
    ["NATE-Certified Tune-Up", "NATE-Certified tune-up"],
    ["SAME-DAY SERVICE", "Same-day service"],
    ["iPhone Repair", "iPhone repair"],
    ["QuickBooks Setup", "QuickBooks setup"],
    ["Drain cleaning", "Drain cleaning"],
  ]);
  for (const [source, expected] of examples) {
    assert.equal(normalizeServiceDisplayLabel(source), expected, source);
  }
});

test("renderer and public packet share normalized service display labels", async (t) => {
  const outDir = mkdtempSync(path.join(tmpdir(), "siteforge-service-display-"));
  t.after(() => rmSync(outDir, { recursive: true, force: true }));

  await build({
    slug: "service-display-proof",
    forge: { demo: true },
    business: {
      name: "Example Service Company",
      category: "plumbing",
      city: "Austin",
      state: "TX",
    },
    services: [
      "same-Day Service",
      "professional Plumbing Solutions",
      "HVAC Repair",
    ],
    media: { catalog: [] },
    enrichment_sources: {},
  }, { outDir, capture: false });

  const html = readFileSync(path.join(outDir, "index.html"), "utf8");
  const packet = JSON.parse(readFileSync(path.join(outDir, "packet.json"), "utf8"));
  assert.deepEqual(packet.services, [
    "Same-day service",
    "Professional plumbing solutions",
    "HVAC repair",
  ]);
  for (const service of packet.services) assert.match(html, new RegExp(service, "g"));
  assert.doesNotMatch(html, /same-Day Service|professional Plumbing Solutions|HVAC Repair/);
});
