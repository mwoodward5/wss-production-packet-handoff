"use strict";

// Every string here was MEASURED on the rebuilt Rose City Heating & Air mirror
// (wss-test-rose-city-heating-and-air-portland.wss-ai.com) on 2026-08-11, in a
// live schema.org Service node, after the identity-copy rebuild. Four of the
// twelve services that mirror published were the suburbs of Portland and two
// were promotions.

const test = require("node:test");
const assert = require("node:assert");

const { articleHeadlineReason } = require("../lib/mirror-engine/service-names");

test("promo labels are refused whatever qualifier precedes them", () => {
  // Both shipped live. `specials?` and `rebates?` were already blocked as
  // WHOLE labels, which is exactly why these two spellings walked through.
  assert.strictEqual(articleHeadlineReason("Web Specials"), "navigation_label");
  assert.strictEqual(articleHeadlineReason("Rebates & Incentives"), "navigation_label");
  assert.strictEqual(articleHeadlineReason("Rebates and Incentives"), "navigation_label");
  assert.strictEqual(articleHeadlineReason("Online Specials"), "navigation_label");
  assert.strictEqual(articleHeadlineReason("Incentives"), "navigation_label");
});

test("a real service that merely contains a promo word survives", () => {
  // The refusal is whole-label. These name things a customer can buy.
  assert.strictEqual(articleHeadlineReason("Rebate-Eligible Heat Pump Installation"), "");
  assert.strictEqual(articleHeadlineReason("Special Order Parts Fabrication"), "");
});

test("a city landing page is not a service page, and its zip code says so", () => {
  // Rose City files each suburb at
  //   clackamas-or-97015-air-conditioning-services.php
  // which ENDS in "air-conditioning-services" and so reads as the most
  // service-like URL on the site. The {state}-{zip} pair is the giveaway.
  const { isNonServicePath } = require("../lib/mirror-engine/verified-facts");
  assert.strictEqual(typeof isNonServicePath, "function", "verified-facts must expose isNonServicePath");

  assert.strictEqual(isNonServicePath("/clackamas-or-97015-air-conditioning-services.php"), true);
  assert.strictEqual(isNonServicePath("/beaverton-or-97005-air-conditioning-services.php"), true);
  assert.strictEqual(isNonServicePath("/portland-or-97219-air-conditioning-services.php"), true);

  // Real service slugs must be untouched — including the numeric ones that a
  // bare five-digit test would have destroyed.
  assert.strictEqual(isNonServicePath("/services/ductless-mini-split-installation"), false);
  assert.strictEqual(isNonServicePath("/24000-btu-installation"), false);
  assert.strictEqual(isNonServicePath("/50-100-amp-panel-upgrades"), false);
});

test("a word the same page publishes as a town is not also a service", () => {
  const { withUsableServices } = require("../lib/mirror-engine/content-inject");
  assert.strictEqual(typeof withUsableServices, "function", "content-inject must expose withUsableServices");

  // "Beaverton" rendered TWICE on the live page: as a service card and as a
  // driving-directions town. The place list wins.
  const out = withUsableServices({
    services: [{ name: "Furnaces" }, { name: "Beaverton" }, { name: "Heat Pumps" }, { name: "Clackamas" }],
    nearby: [{ name: "Beaverton", state: "OR", miles: 7 }],
    areas: ["Clackamas"],
  });
  assert.deepStrictEqual(out.services.map((s) => s.name), ["Furnaces", "Heat Pumps"]);
});

test("a service that merely names where it is performed survives", () => {
  const { withUsableServices } = require("../lib/mirror-engine/content-inject");
  const out = withUsableServices({
    services: [{ name: "Beaverton Furnace Repair" }],
    nearby: [{ name: "Beaverton", state: "OR", miles: 7 }],
  });
  assert.deepStrictEqual(out.services.map((s) => s.name), ["Beaverton Furnace Repair"]);
});
