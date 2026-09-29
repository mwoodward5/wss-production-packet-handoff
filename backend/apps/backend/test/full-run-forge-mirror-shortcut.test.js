"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// ROUTING REGRESSION LOCK (2026-08-14).
//
// Completed Forge and SiteForge records are historical evidence only. Every
// fresh preview must ask the Mirror Engine for build-specific evidence; a
// refusal must fail closed. The sole legacy exception is an exact, persisted,
// pending SiteForge job read by the reconciler without starting new work.

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "full-run.js"), "utf8");

test("a completed Forge job never shortcuts a fresh Mirror Engine build", () => {
  const marker = src.indexOf("// ALL FRESH BUILDS USE MIRROR ENGINE");
  assert.notEqual(marker, -1, "fresh-build routing marker must remain explicit");
  const freshBlock = src.slice(marker, src.indexOf("const pending =", marker));

  assert.match(freshBlock, /dispatchMirrorLane\(buildProspect/);
  assert.doesNotMatch(freshBlock, /dispatchSiteForgePreview/);
  assert.doesNotMatch(freshBlock, /completedForgeJob|forgeAliasEarly|forge_job_mirror/);
  assert.doesNotMatch(src, /const\s+forgeAliasEarly\b|const\s+completedForgeJob\b/);
});

test("completed Forge records remain archived and readable, never current proof", () => {
  assert.match(src, /const historicalForgeJob = isObject\(durableProspectRecord\.forge_job\)/);
  assert.match(src, /\.\.\.\(historicalForgeJob \? \{ forge_job: historicalForgeJob \} : \{\}\)/);
  assert.match(src, /legacy_build_dispatch/);
  assert.match(src, /\["http_dispatch", "existing_job_status_read", "forge_job_mirror"\]/);
});

test("only the reconciler can drain an exact persisted pending SiteForge job", () => {
  const marker = src.indexOf("const legacyResume =");
  const freshMarker = src.indexOf("// ALL FRESH BUILDS USE MIRROR ENGINE", marker);
  const legacyBlock = src.slice(marker, freshMarker);

  assert.match(legacyBlock, /source === "siteforge_reconcile"/);
  assert.match(legacyBlock, /legacySiteForgePendingResume\(durableProspect, id\)/);
  assert.match(legacyBlock, /observed\?\.mode === "existing_job_status_read"/);
  assert.match(legacyBlock, /legacy_siteforge_status_reader_required/);
  assert.match(legacyBlock, /options\.freshDispatch !== true/);
  assert.match(legacyBlock, /options\.forceFreshDispatch !== true/);
});

test("a Mirror Engine refusal fails closed under the native renderer identity", () => {
  const start = src.indexOf("function blockedLeadMinerMirrorDispatch");
  const end = src.indexOf("async function refusalEvent", start);
  const refusalBlock = src.slice(start, end);

  assert.match(refusalBlock, /mode: "mirror_lane"/);
  assert.match(refusalBlock, /fail_closed: true/);
  assert.match(refusalBlock, /renderer: MIRROR_ENGINE_RENDERER/);
  assert.match(refusalBlock, /required_renderer: MIRROR_ENGINE_RENDERER/);
  assert.doesNotMatch(refusalBlock, /05-build-v8|forge_job_mirror|http_dispatch/);
});

test("a blocked forge job is never treated as a completed mirror", () => {
  // forge-jobs.js sets stage to "blocked" XOR "done" from the same assignment
  // (job.audit.verdict === "BLOCKED" ? "blocked" : "done") — they cannot both
  // be true for the same job, so requiring stage==="done" is sufficient and
  // this test exists to keep that invariant from silently drifting apart.
  const jobsSrc = fs.readFileSync(path.join(__dirname, "..", "api", "admin", "forge-jobs.js"), "utf8");
  assert.match(jobsSrc, /job\.stage = job\.audit\.verdict === "BLOCKED" \? "blocked" : "done"/);
});
