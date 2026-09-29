"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const consoleData = require("../api/admin/console-data");

const hash40 = "a".repeat(40);
const hash64 = "b".repeat(64);

test("V2 projection shows mapped donors without promoting unfinished ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wss-v2-catalog-"));
  try {
    const file = path.join(dir, "catalog.json");
    const base = {
      implementation_status: "WSS_ADAPTED", source_import_verified: true,
      client_bindings_verified: true, source_commit: hash40,
      source_tree_sha256: hash64, bundle: hash64,
    };
    fs.writeFileSync(file, JSON.stringify({ schema: "wss-donor-catalog-v2", donors: [
      { ...base, vertical: "concrete", runtime_eligible: false, visual_parity_verified: false },
      { ...base, vertical: "concrete", runtime_eligible: true, visual_parity_verified: true },
      { ...base, vertical: "landscaping", runtime_eligible: false, visual_parity_verified: false },
      { ...base, vertical: "plumbing", implementation_status: "REJECTED_GENERIC_SCAFFOLD", runtime_eligible: true, visual_parity_verified: true },
    ] }));
    assert.deepEqual(consoleData.mappedV2Verticals({ catalogPath: file }), {
      available: true,
      verticals: [
        { vertical: "concrete", label: "Concrete", donors: 2, readyDonors: 1 },
        { vertical: "landscaping", label: "Landscaping", donors: 1, readyDonors: 0 },
      ],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("missing V2 catalog is explicit unavailability", () => {
  assert.deepEqual(consoleData.mappedV2Verticals({ catalogPath: "" }), { available: false, verticals: [] });
});
