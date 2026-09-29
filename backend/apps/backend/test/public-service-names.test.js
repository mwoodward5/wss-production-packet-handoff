"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { publicServiceNames } = require("../lib/public-data");

test("directory page titles are stripped from harvested services, real services kept", () => {
  const out = publicServiceNames([
    "Arkansas Construction and Remodeling, LLC | BBB Business Profile | Better Business Bureau",
    "Custom Gate Installation",
    "Rot Repair",
    "Yelp: Acme Fence Co",
    "Fence Contractors on HomeAdvisor",
  ], "fence repair");
  assert.deepEqual(out, ["Custom Gate Installation", "Rot Repair", "fence repair"]);
});
