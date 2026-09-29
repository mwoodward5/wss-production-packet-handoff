"use strict";

// Finding 4B: a word-empty service description (".", "-", whitespace) both
// printed literally as the card body AND overrode the donor's own generated
// intro (intro: e.description || n.intro). withUsableServices now drops such
// descriptions so the honest name/business fallback shows; digit-bearing copy
// like "24/7" (>=2 alphanumerics) survives.
const test = require("node:test");
const assert = require("node:assert/strict");
const { withUsableServices } = require("../lib/mirror-engine/content-inject.js");

test("word-empty descriptions are scrubbed; real and 24/7 copy survive", () => {
  const out = withUsableServices({
    services: [
      { name: "Wood Fence Installation", description: "." },
      { name: "Ornamental Iron", description: "  -  " },
      { name: "Chain Link", description: "Durable galvanized chain link fencing." },
      { name: "Emergency Repair", description: "24/7" },
    ],
  }, "Metro Fence Company");
  const s = out.services;
  assert.equal(s[0].description, undefined, "'.' must be dropped");
  assert.equal(s[1].description, undefined, "'-' must be dropped");
  assert.match(s[2].description, /Durable/, "real description kept");
  assert.equal(s[3].description, "24/7", "24/7 kept");
  // Names are untouched.
  assert.equal(s[0].name, "Wood Fence Installation");
});

test("string services and description-less services pass through unchanged", () => {
  const content = { services: ["Wood Fencing", { name: "Vinyl" }] };
  const out = withUsableServices(content, "Metro Fence");
  assert.deepEqual(out.services, ["Wood Fencing", { name: "Vinyl" }]);
});
