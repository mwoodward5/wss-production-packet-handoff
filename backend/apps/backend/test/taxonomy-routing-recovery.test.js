"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { approvedIndustry } = require("../lib/copilot");
const { inferTrade } = require("../lib/trade-inference");
const { resolveAlias } = require("../lib/donor-verticals");
const {
  ALL_TRADES_VERTICAL_ORDER,
  openVerticalNames,
} = require("../lib/line-quota");

const expectedRoutes = new Map([
  ["plumber", ["plumbing", "plumbing-clean"]],
  ["plumbing contractor", ["plumbing", "plumbing-clean"]],
  ["carpenter", ["general contractor", "general-contractor-clean"]],
  ["carpentry", ["general contractor", "general-contractor-clean"]],
  ["construction", ["general contractor", "general-contractor-clean"]],
  ["framing", ["general contractor", "general-contractor-clean"]],
  ["cabinetry", ["general contractor", "general-contractor-clean"]],
  ["trim carpentry", ["general contractor", "general-contractor-clean"]],
  ["arborist", ["tree service", "landscaping-evergreen"]],
  ["tree service", ["tree service", "landscaping-evergreen"]],
  ["tree removal", ["tree service", "landscaping-evergreen"]],
  ["stump grinding", ["tree service", "landscaping-evergreen"]],
  ["gardening", ["landscaping", "landscaping-evergreen"]],
  ["garden services", ["landscaping", "landscaping-evergreen"]],
  ["lawn garden", ["landscaping", "landscaping-evergreen"]],
]);

test("service category aliases select the intended canonical donor", () => {
  for (const [input, [vertical, donor]] of expectedRoutes) {
    assert.equal(approvedIndustry(input), vertical, input);
    assert.equal(resolveAlias(input, {}).donor, donor, input);
  }
});

test("service evidence derives carpenter and tree businesses into installed donor lanes", () => {
  const carpenter = inferTrade({
    label: "construction company",
    businessName: "Craftline Carpentry",
    services: ["Custom cabinetry", "Trim carpentry", "Home framing"],
  });
  assert.equal(carpenter.trade, "general contractor");
  assert.equal(approvedIndustry(carpenter.trade), "general contractor");

  const arborist = inferTrade({
    label: "tree care",
    businessName: "Canopy Arborists",
    services: ["Tree removal", "Stump grinding", "Tree service"],
  });
  assert.equal(arborist.trade, "landscaping");
  assert.equal(approvedIndustry(arborist.trade), "landscaping");
});

test("automatic All Trades uses the explicit service-template roster", () => {
  const supplied = [
    { vertical: "tattoo" },
    { vertical: "real estate agent" },
    { vertical: "salon" },
    { vertical: "plumbing" },
    { vertical: "landscaping" },
    { vertical: "roofing", outreachRetired: true },
    { vertical: "product store" },
  ];
  assert.deepEqual(openVerticalNames(supplied), ["plumbing", "landscaping", "salon", "tattoo"]);
  assert.ok(ALL_TRADES_VERTICAL_ORDER.includes("salon"));
  assert.ok(ALL_TRADES_VERTICAL_ORDER.includes("tattoo"));
  assert.ok(!ALL_TRADES_VERTICAL_ORDER.includes("real estate agent"));
  assert.ok(!ALL_TRADES_VERTICAL_ORDER.includes("product store"));
});

test("real estate remains buildable only by explicit request", () => {
  assert.equal(approvedIndustry("realtor"), "real estate agent");
  assert.equal(resolveAlias("real estate", {}).donor, "realestate-waterline");
  assert.deepEqual(openVerticalNames([{ vertical: "real estate agent" }]), []);
});

test("salon and tattoo keep their explicit category behavior", () => {
  assert.equal(approvedIndustry("hair salons"), "hair salon");
  assert.equal(approvedIndustry("tattoo artists"), "tattoo");
});
