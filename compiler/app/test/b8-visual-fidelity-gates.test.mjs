import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const source = readFileSync(
  path.join(repoRoot, "scripts", "b8-verify-sameness.mjs"),
  "utf8",
);

test("B8 evaluates visual fidelity for each preview against the cohort sites root", () => {
  assert.match(
    source,
    /for \(const build of builds\)[\s\S]*?runVisualFidelityChecks\(build\.siteDir, \{ batchDir: sitesRoot \}\)/,
  );
});

test("B8 blocks pass on the conversion rail and both hero batch gates", () => {
  for (const gate of [
    "visual-conversion-rail",
    "visual-hero-anatomy-batch",
    "visual-hero-architecture-batch",
  ]) {
    assert.match(source, new RegExp(`HARD_VISUAL_GATE_NAMES[\\s\\S]*?"${gate}"`));
  }
  assert.match(
    source,
    /const hardVisualFailures = collectHardVisualFailures\(build\.slug, fidelityResults\);[\s\S]*?if \(hardVisualFailures\.length > 0\) \{[\s\S]*?throw createHardVisualGateError\(build\.slug, hardVisualFailures\);/,
  );
  assert.ok(
    source.indexOf("throw createHardVisualGateError(build.slug, hardVisualFailures);")
      < source.indexOf('status: "pass"'),
    "hard visual gates must run before the pass summary is returned",
  );
});

test("B8 persists structured visual failures in the proof summary", () => {
  assert.match(source, /error\.summaryFailures = failures;/);
  assert.match(
    source,
    /const failure = \{[\s\S]*?status: "fail"[\s\S]*?failures,[\s\S]*?\};[\s\S]*?safeWriteJson\(outputRoot, path\.join\(outputRoot, "b8-summary\.json"\), failure\);/,
  );
});
