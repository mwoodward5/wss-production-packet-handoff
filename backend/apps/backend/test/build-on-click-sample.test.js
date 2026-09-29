"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { sampledBuildOnClick, buildOnClickEnabled } = require("../lib/build-on-click");

const SAMPLE_ENV = { SITEFORGE_BUILD_ON_CLICK_SAMPLE: "0.1" };

test("sampling is deterministic per prospect id", () => {
  const a = sampledBuildOnClick("prospect-abc-123", SAMPLE_ENV);
  const b = sampledBuildOnClick("prospect-abc-123", SAMPLE_ENV);
  assert.equal(a, b);
});

test("global flag still forces reveal lane for every prospect", () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(sampledBuildOnClick(`p-${i}`, { SITEFORGE_BUILD_ON_CLICK: "true" }), true);
  }
});

test("no sample env means nobody gets reveal lane (prebuilt default)", () => {
  for (let i = 0; i < 50; i++) {
    assert.equal(sampledBuildOnClick(`p-${i}`, {}), false);
  }
});

test("invalid sample env values fall back to prebuilt-only safely", () => {
  for (const bad of ["banana", "-1", "0", "2", "1/0", "%", ""]) {
    assert.equal(
      sampledBuildOnClick("p-x", { SITEFORGE_BUILD_ON_CLICK_SAMPLE: bad }),
      false,
      `env=${JSON.stringify(bad)} should not sample`,
    );
  }
});

test("fraction parsers: 0.1, 10%, and 1/10 all mean the same thing", () => {
  const results = new Set();
  for (const v of ["0.1", "10%", "1/10"]) {
    let hits = 0;
    for (let i = 0; i < 1000; i++) {
      if (sampledBuildOnClick(`p-${i}`, { SITEFORGE_BUILD_ON_CLICK_SAMPLE: v })) hits++;
    }
    results.add(hits);
  }
  assert.equal(results.size, 1, "all three notations should sample identically");
});

test("sample ratio lands near 10% over 1000 prospects", () => {
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    if (sampledBuildOnClick(`p-${i}`, SAMPLE_ENV)) hits++;
  }
  assert.ok(hits >= 70 && hits <= 130, `expected ~100 hits ±30, got ${hits}`);
});

test("buildOnClickEnabled parsing is unchanged", () => {
  assert.equal(buildOnClickEnabled({ SITEFORGE_BUILD_ON_CLICK: "true" }), true);
  assert.equal(buildOnClickEnabled({ SITEFORGE_BUILD_ON_CLICK: "1" }), true);
  assert.equal(buildOnClickEnabled({ SITEFORGE_BUILD_ON_CLICK: "false" }), false);
  assert.equal(buildOnClickEnabled({}), false);
});
