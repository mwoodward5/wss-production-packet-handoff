import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeLiveSourceTruth } from "../lib/engine-adapter.mjs";
import { sanitizeSourceAssets } from "../lib/source-intake.mjs";

test("live source truth rejects arbitrary serialized object members", () => {
  const sanitized = sanitizeLiveSourceTruth({
    facts: {
      services: [
        'image\\": \\"https://example.com/logo.png\\",',
        'aggregateRating\\": {',
        '"geo": {"@type":"GeoCoordinates"}',
        '{\\"@type\\":\\"Service\\"}',
        '[{\\"name\\":\\"Drain Cleaning\\"}]',
        '["Leak Detection","Drain Repair"]',
        "contactType...",
        "Image Restoration",
        "Name: Brand Strategy",
        "[Residential] Painting",
      ],
    },
  });

  assert.deepEqual(sanitized.services, [
    "Image Restoration",
    "Name: Brand Strategy",
    "[Residential] Painting",
  ]);
});

test("live source truth preserves comma-bearing services and legitimate closing punctuation", () => {
  const commaService = sanitizeLiveSourceTruth({
    facts: {
      address: "123 Main St [Rear]",
      services: "Heating, Ventilation, and Air Conditioning",
    },
  });
  assert.equal(commaService.address, "123 Main St [Rear]");
  assert.deepEqual(commaService.services, [
    "Heating, Ventilation, and Air Conditioning",
  ]);

  const punctuation = sanitizeLiveSourceTruth({
    facts: {
      services: [
        "HVAC [Commercial]",
        'Owner\'s "Signature"',
        "Repair, Maintenance,",
      ],
    },
  });
  assert.deepEqual(punctuation.services, [
    "HVAC [Commercial]",
    'Owner\'s "Signature"',
    "Repair, Maintenance,",
  ]);
});

test("live source truth rejects non-string addresses without coercion", () => {
  const fallback = sanitizeLiveSourceTruth({
    facts: {
      address: { streetAddress: "should not be coerced" },
    },
    intake: {
      address: "12 Service Lane, Exampletown, TX 75001",
    },
  });
  assert.equal(fallback.address, "12 Service Lane, Exampletown, TX 75001");
  assert.notEqual(fallback.address, "[object Object]");

  const rejected = sanitizeLiveSourceTruth({
    facts: { address: ["12 Service Lane"] },
    intake: { address: { value: "12 Service Lane" } },
  });
  assert.equal(rejected.address, "");
  assert.equal(rejected.facts.address, "");
});

test("public source asset sanitation removes caller-supplied local paths", () => {
  const [asset] = sanitizeSourceAssets([{
    kind: "logo",
    url: "https://assets.example.com/verified-logo.png",
    source: "business-site",
    origin: "business-evidence",
    approved: true,
    local_path: "C:\\private\\outside-root.png",
    meta: {
      local_path: "C:\\private\\outside-root.png",
      transformed_asset_path: "..\\outside-root.png",
    },
  }]);

  assert.ok(asset);
  assert.equal(Object.hasOwn(asset, "local_path"), false);
  assert.equal(Object.hasOwn(asset.meta || {}, "local_path"), false);
  assert.equal(Object.hasOwn(asset.meta || {}, "transformed_asset_path"), false);
});
