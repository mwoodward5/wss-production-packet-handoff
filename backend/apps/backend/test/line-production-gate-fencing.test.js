"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FENCING_DONOR,
  FENCING_ADJACENT_TERMS,
  reconcileFencingDonor,
} = require("../lib/line-production-gate");

test("verified fencing donor may mention concrete for fence-post installation", () => {
  assert.equal(FENCING_DONOR, "fencing-sterling");
  assert.deepEqual(FENCING_ADJACENT_TERMS, ["concrete"]);
  const dom = {
    ok: true,
    donorText: "Wood and ornamental fencing with concrete-set posts. Concrete driveway replacement is a separate trade.",
  };
  const fixed = reconcileFencingDonor(dom, {
    vertical: "fencing",
    build_donor: "fencing-sterling",
  });
  assert.doesNotMatch(fixed.donorText, /\bconcrete\b/i);
  assert.deepEqual(fixed.vertical_adjacency_reconciled, {
    donor: "fencing-sterling",
    removed: ["concrete"],
  });
});

test("fencing adjacency reconciliation is donor and vertical scoped", () => {
  const dom = { ok: true, donorText: "Concrete driveway replacement" };
  assert.equal(reconcileFencingDonor(dom, {
    vertical: "roofing",
    build_donor: "fencing-sterling",
  }).donorText, dom.donorText);
  assert.equal(reconcileFencingDonor(dom, {
    vertical: "fencing",
    build_donor: "concrete-elconstruction",
  }).donorText, dom.donorText);
});
