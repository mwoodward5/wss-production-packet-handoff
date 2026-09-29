import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const intakeGenie = readFileSync(new URL("../lib/intake-genie.mjs", import.meta.url), "utf8");

test("source-backed cache hits require fresh source pages plus usable evidence", () => {
  assert.match(intakeGenie, /const cached = cacheHasSourceEvidence\(cachedResult, input\) \? cachedResult : null/);
  assert.match(intakeGenie, /Empty\/manual discovery results are never authoritative for a supplied\s*\/\/ website/);
  assert.match(intakeGenie, /const hasMedia = assets\.some\(\(asset\) => \["logo", "photo", "video"\]\.includes\(asset\?\.kind\) && asset\?\.url\)/);
  assert.match(intakeGenie, /const hasBusinessFacts = Boolean\(found\.copy \|\| found\.services\?\.length \|\| cached\.discovery\?\.facts\?\.services\?\.length\)/);
  assert.match(intakeGenie, /return pagesRead > 0 && \(hasMedia \|\| hasBusinessFacts\)/);
});

test("source-backed cache writes use the same evidence gate", () => {
  const readGate = intakeGenie.indexOf("const cached = cacheHasSourceEvidence(cachedResult, input)");
  const writeGate = intakeGenie.indexOf("if (cacheHasSourceEvidence({ assets: packet.assets, discovery: cacheableDiscovery }, input))");
  const write = intakeGenie.indexOf("writeCache(key,", writeGate);

  assert.ok(readGate >= 0, "cache reads should apply the source-evidence gate");
  assert.ok(writeGate > readGate, "cache writes should happen after the compile result is built");
  assert.ok(write > writeGate, "cache writes should be nested under the source-evidence gate");
});
