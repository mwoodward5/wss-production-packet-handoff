import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeLiveSourceTruth } from "../lib/engine-adapter.mjs";

test("live Intake Genie truth drops structured fragments and cleans valid services and address", () => {
  const sanitized = sanitizeLiveSourceTruth({
    facts: {
      address: '12 Service Lane\\",',
      services: [
        '@type\\": \\"Plumber\\",',
        'name\\": \\"Example Plumbing\\",',
        'contactType\\": \\"customer service\\",',
        "Leak Detection Services\\\\",
        "Drain Repair and Installation\\\\",
        "Sewer Line Repair and Installation\\\\",
      ],
    },
  });

  assert.equal(sanitized.address, "12 Service Lane");
  assert.equal(sanitized.facts.address, "12 Service Lane");
  assert.deepEqual(sanitized.services, [
    "Leak Detection Services",
    "Drain Repair and Installation",
    "Sewer Line Repair and Installation",
  ]);
  assert.deepEqual(sanitized.facts.services, sanitized.services);
});

test("valid source truth survives sanitation and duplicate services collapse case-insensitively", () => {
  const sanitized = sanitizeLiveSourceTruth({
    facts: {
      address: "12 Service Lane",
      services: ["Water Heater Repair", "Drain Cleaning", "drain cleaning"],
    },
    intake: {
      address: "999 Stale Address",
      services: ["Unrelated fallback"],
    },
  });

  assert.equal(sanitized.address, "12 Service Lane");
  assert.deepEqual(sanitized.services, ["Water Heater Repair", "Drain Cleaning"]);
  assert.equal(sanitized.intake.address, "12 Service Lane");
  assert.deepEqual(sanitized.intake.services, sanitized.services);
});

test("clean intake truth is used when malformed facts contain no usable value", () => {
  const sanitized = sanitizeLiveSourceTruth({
    facts: {
      address: 'address\\": \\"12 Service Lane\\",',
      services: ['@type\\": \\"Plumber\\",', "contactType..."],
    },
    intake: {
      address: "12 Service Lane, Exampletown, TX 75001",
      services: ["Emergency Plumbing", "Leak Detection"],
    },
  });

  assert.equal(sanitized.address, "12 Service Lane, Exampletown, TX 75001");
  assert.deepEqual(sanitized.services, ["Emergency Plumbing", "Leak Detection"]);
  assert.deepEqual(sanitized.facts.services, sanitized.services);
});

test("source addresses drop Markdown link tails without losing the sourced address", () => {
  const danglingTail = sanitizeLiveSourceTruth({
    facts: {
      address: "1600 Main St, Houston, TX 77002](https://maps.example/place)",
    },
  });
  assert.equal(danglingTail.address, "1600 Main St, Houston, TX 77002");

  const wholeLink = sanitizeLiveSourceTruth({
    facts: {
      address: "[1600 Main St, Houston, TX 77002](https://maps.example/place)",
    },
  });
  assert.equal(wholeLink.address, "1600 Main St, Houston, TX 77002");

  const labeledTail = sanitizeLiveSourceTruth({
    facts: {
      address: "1600 Main St, Houston, TX 77002 [Directions](https://maps.example/place)",
    },
  });
  assert.equal(labeledTail.address, "1600 Main St, Houston, TX 77002");

  const truncatedTail = sanitizeLiveSourceTruth({
    facts: {
      address: "13100 Wortham Center Drive, Houston, TX 77065](https://www.google.com/map",
    },
  });
  assert.equal(truncatedTail.address, "13100 Wortham Center Drive, Houston, TX 77065");
});

test("source addresses drop pipe-delimited phone and domain tails before render", () => {
  const sunset = sanitizeLiveSourceTruth({
    facts: {
      address: String.raw`2807 S. Fifth Ave Tucson, Arizona 85713 \\| 520-400-1741 \\| sunsetro`,
    },
    intake: {
      address: "stale fallback",
    },
  });
  assert.equal(sunset.address, "2807 S. Fifth Ave Tucson, Arizona 85713");
  assert.equal(sunset.facts.address, sunset.address);
  assert.equal(sunset.intake.address, sunset.address);

  const literalPipes = sanitizeLiveSourceTruth({
    intake: {
      address: "9 Market St, Reno, NV 89501 | (775) 555-0100 | mapped.example",
    },
  });
  assert.equal(literalPipes.address, "9 Market St, Reno, NV 89501");

  const validAddress = sanitizeLiveSourceTruth({
    facts: {
      address: "55 W. River Road, Building B, Austin, TX 78701",
    },
  });
  assert.equal(validAddress.address, "55 W. River Road, Building B, Austin, TX 78701");
});

test("source services restore missing camel-case word boundaries", () => {
  const sanitized = sanitizeLiveSourceTruth({
    facts: {
      services: ["HoustonPlumber", "houstonPlumber", "HVACRepair", "Water Heater Repair"],
    },
  });

  assert.deepEqual(sanitized.services, ["Houston Plumber", "HVAC Repair", "Water Heater Repair"]);
});
