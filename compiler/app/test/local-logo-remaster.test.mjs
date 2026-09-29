import test from "node:test";
import assert from "node:assert/strict";
import { remasterLogoLocal } from "../../factory/lib/asset-remaster/local-logo-remaster.mjs";

test("missing input never claims a transformation", async () => {
  const r = await remasterLogoLocal("", "/tmp");
  assert.equal(r.performed, false);
  assert.ok(["no-sharp", "input-missing"].includes(r.reason));
});

test("unreadable url degrades safely (no throw, performed false)", async () => {
  const r = await remasterLogoLocal("https://invalid.invalid/nope.png", "/tmp");
  assert.equal(r.performed, false);
});
