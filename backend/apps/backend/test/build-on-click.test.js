"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { buildOnClickEnabled, prospectPreviewUrl, revealRunId } = require("../lib/build-on-click");

test("buildOnClickEnabled parses the flag", () => {
  for (const v of ["1", "true", "on", "YES"]) assert.equal(buildOnClickEnabled({ SITEFORGE_BUILD_ON_CLICK: v }), true);
  for (const v of ["", "0", "false", "off", undefined]) assert.equal(buildOnClickEnabled({ SITEFORGE_BUILD_ON_CLICK: v }), false);
});

test("prospectPreviewUrl only returns https previews", () => {
  assert.equal(prospectPreviewUrl({ preview_url: "https://x.test/try/" }), "https://x.test/try/");
  assert.equal(prospectPreviewUrl({ record: { preview_url: "https://y.test/try/" } }), "https://y.test/try/");
  assert.equal(prospectPreviewUrl({ preview_url: "http://insecure/" }), "");
  assert.equal(prospectPreviewUrl({}), "");
});

test("revealRunId is deterministic and sanitized", () => {
  assert.equal(revealRunId("place-abc_123"), "reveal_place-abc_123");
  assert.equal(revealRunId("a/b c!"), "reveal_abc");
  assert.equal(revealRunId("place-x"), revealRunId("place-x"));
});
