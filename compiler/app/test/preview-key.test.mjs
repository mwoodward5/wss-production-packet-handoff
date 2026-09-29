import assert from "node:assert/strict";
import test from "node:test";
import { privatePreviewKey } from "../lib/util.mjs";

test("private preview keys are recognizable and retain private entropy", () => {
  const key = privatePreviewKey("Richard Diaz Landscape & Masonry", "AbC_123-private");
  assert.equal(key, "richard-diaz-landscape-and-masonry-abc_123-private");
  assert.match(key, /^[a-z0-9_-]+$/);
  assert.ok(key.startsWith("richard-diaz-landscape"));
});

test("private preview keys bound long business names", () => {
  const key = privatePreviewKey("A very long local business name that should not dominate the entire preview URL", "secure-token");
  assert.ok(key.length <= 59);
  assert.ok(key.endsWith("-secure-token"));
});
