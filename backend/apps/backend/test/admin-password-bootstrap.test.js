"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  bootstrapPasswordMatches,
  OWNER_BOOTSTRAP_SALT,
  OWNER_BOOTSTRAP_HASH,
} = require("../lib/admin-password");

test("owner bootstrap verifier is hash-only and disables after first password change", () => {
  assert.match(OWNER_BOOTSTRAP_SALT, /^[A-Za-z0-9_-]{20,}$/);
  assert.match(OWNER_BOOTSTRAP_HASH, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(bootstrapPasswordMatches("Kr@@@0387rici", 1), true);
  assert.equal(bootstrapPasswordMatches("Kr@@@0387rici ", 1), true);
  assert.equal(bootstrapPasswordMatches("Kr@@@0387rici", 2), false);
  assert.equal(bootstrapPasswordMatches("wrong-password", 1), false);
});
