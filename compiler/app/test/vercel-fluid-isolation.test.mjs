import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(
  readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
);

test("Vercel isolates CPU-heavy Chromium advances from Fluid concurrency", () => {
  assert.equal(config.$schema, "https://openapi.vercel.sh/vercel.json");
  assert.equal(config.fluid, false);

  const apiFunction = config.functions?.["api/index.mjs"];
  assert.ok(apiFunction, "api/index.mjs function config must remain present");
  assert.equal(apiFunction.maxDuration, 300);
  assert.equal(apiFunction.memory, 3009);
});
