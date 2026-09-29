"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { GATES, siteforgeQcEvidence } = require("../lib/siteforge-qc-evidence");

test("rejects legacy runtime even when flags claim ready", () => {
  const qc = Object.fromEntries(GATES.map(([, , aliases]) => [aliases[0], true]));
  const result = siteforgeQcEvidence({ renderer: "legacy-wordpress", release_ready: true, qc });
  assert.equal(result.releaseReady, false);
  assert.ok(result.failedGates.includes("v8_wss_launch_runtime"));
});

test("requires visible evidence for every V8 release gate", () => {
  const qc = Object.fromEntries(GATES.map(([, , aliases]) => [aliases[0], { passed: true, evidence: "artifact" }]));
  qc.map.passed = false;
  const result = siteforgeQcEvidence({ renderer: "siteforge-renderer-v8-snowflake@8.2.0", release_ready: true, qc });
  assert.equal(result.outreachEligible, false);
  assert.ok(result.failedGates.includes("map"));
});

test("passes only V8 plus all gates plus declared release readiness", () => {
  const qc = Object.fromEntries(GATES.map(([, , aliases]) => [aliases[0], { passed: true, evidence: "artifact" }]));
  const result = siteforgeQcEvidence({ renderer: "siteforge-renderer-v8-snowflake@8.2.0", release_ready: true, qc });
  assert.equal(result.outreachEligible, true);
  assert.deepEqual(result.failedGates, []);
});
