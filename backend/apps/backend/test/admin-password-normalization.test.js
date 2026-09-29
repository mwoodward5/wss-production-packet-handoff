"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizePasswordInput } = require("../lib/admin-password");

test("owner login ignores accidental surrounding paste whitespace only", () => {
  assert.equal(normalizePasswordInput("  Example@@1234  \r\n"), "Example@@1234");
  assert.equal(normalizePasswordInput("Example @@ 1234"), "Example @@ 1234");
  assert.equal(normalizePasswordInput(null), "");
});
