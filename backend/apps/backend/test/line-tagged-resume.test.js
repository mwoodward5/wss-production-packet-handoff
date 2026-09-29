"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const tagged = require("../lib/line-tagged-resume");

const TOKEN_ENV = "VERCEL_TOKEN";
const TEAM_ENV = "VERCEL_TEAM_ID";
const PROJECT_ENV = "VERCEL_PROJECT_ID";
const NAME_ENV = "VERCEL_PROJECT_NAME";

function deployment({
  id,
  state = "READY",
  projectId = "prj_customer",
  name = "customer-site",
  operation = "op-hmac",
  build = "build-hash",
  url,
} = {}) {
  return {
    uid: id,
    url: url || `${String(id).replace(/_/g, "-")}.vercel.app`,
    readyState: state,
    projectId,
    name,
    meta: {
      operation_key_hmac_sha256: operation,
      build_hash: build,
    },
  };
}

async function withVercelList(rows, run) {
  const originalFetch = global.fetch;
  const old = {
    token: process.env[TOKEN_ENV],
    team: process.env[TEAM_ENV],
    project: process.env[PROJECT_ENV],
    name: process.env[NAME_ENV],
  };
  process.env[TOKEN_ENV] = "test-token";
  process.env[TEAM_ENV] = "team_test";
  delete process.env[PROJECT_ENV];
  delete process.env[NAME_ENV];
  try {
    global.fetch = async (_url, options = {}) => {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      return {
        ok: true,
        status: 200,
        async json() { return { deployments: rows }; },
      };
    };
    return await run();
  } finally {
    global.fetch = originalFetch;
    if (old.token === undefined) delete process.env[TOKEN_ENV]; else process.env[TOKEN_ENV] = old.token;
    if (old.team === undefined) delete process.env[TEAM_ENV]; else process.env[TEAM_ENV] = old.team;
    if (old.project === undefined) delete process.env[PROJECT_ENV]; else process.env[PROJECT_ENV] = old.project;
    if (old.name === undefined) delete process.env[NAME_ENV]; else process.env[NAME_ENV] = old.name;
  }
}

const resolve = () => tagged.resolveLineTaggedDeployment({
  projectId: "prj_customer",
  buildHash: "build-hash",
  operationKeyHmacSha256: "op-hmac",
});

test("duplicate exact retry artifacts reuse the newest READY deployment", async () => {
  const result = await withVercelList([
    deployment({ id: "dpl_newest" }),
    deployment({ id: "dpl_older" }),
    deployment({ id: "dpl_other", operation: "someone-else" }),
  ], resolve);
  assert.equal(result.found, true);
  assert.equal(result.source, "operation_metadata");
  assert.equal(result.deployment.id, "dpl_newest");
  assert.equal(result.duplicateExactCandidates, 2);
});

test("a non-ready twin does not poison an exact READY retry artifact", async () => {
  const result = await withVercelList([
    deployment({ id: "dpl_building", state: "BUILDING" }),
    deployment({ id: "dpl_ready", state: "READY" }),
  ], resolve);
  assert.equal(result.found, true);
  assert.equal(result.deployment.id, "dpl_ready");
  assert.equal(result.duplicateExactCandidates, 2);
});

test("same durable operation can offer a READY hash-drift artifact for engine byte proof", async () => {
  const result = await withVercelList([
    deployment({ id: "dpl_newest", build: "different-hash" }),
    deployment({ id: "dpl_older", build: "older-hash" }),
    deployment({ id: "dpl_other", operation: "someone-else" }),
  ], resolve);
  assert.equal(result.found, true);
  assert.equal(result.source, "operation_metadata_hash_fallback");
  assert.equal(result.deployment.id, "dpl_newest");
  assert.equal(result.hashMismatch, true);
  assert.equal(result.expectedBuildHash, "build-hash");
  assert.equal(result.candidateBuildHash, "different-hash");
  assert.equal(result.sameOperationCandidates, 2);
});

test("exact hash identity always wins over newer same-operation hash drift", async () => {
  const result = await withVercelList([
    deployment({ id: "dpl_newer_drift", build: "different-hash" }),
    deployment({ id: "dpl_exact", build: "build-hash" }),
  ], resolve);
  assert.equal(result.found, true);
  assert.equal(result.source, "operation_metadata");
  assert.equal(result.deployment.id, "dpl_exact");
  assert.equal(result.duplicateExactCandidates, 1);
});

test("a same-operation deployment still building defers another create even when its hash drifted", async () => {
  const result = await withVercelList([
    deployment({ id: "dpl_building", state: "BUILDING", build: "different-hash" }),
  ], resolve);
  assert.equal(result.found, false);
  assert.equal(result.refused, true);
  assert.equal(result.retryable, true);
  assert.match(result.reason, /^deployment_not_ready:/);
});

test("every same-operation candidate remains project-bound and malformed identity fails closed", async () => {
  const wrongProject = await withVercelList([
    deployment({ id: "dpl_good" }),
    deployment({ id: "dpl_wrong", projectId: "prj_other", build: "different-hash" }),
  ], resolve);
  assert.deepEqual(wrongProject, {
    found: false,
    refused: true,
    reason: "deployment_wrong_project",
    actual_project_id: "prj_other",
  });

  const malformed = deployment({ id: "dpl_bad" });
  malformed.id = "different-id";
  const badIdentity = await withVercelList([malformed], resolve);
  assert.deepEqual(badIdentity, {
    found: false,
    refused: true,
    reason: "deployment_invalid_identity",
  });
});

test("no READY exact artifact remains retryable rather than creating another deployment", async () => {
  const result = await withVercelList([
    deployment({ id: "dpl_building", state: "BUILDING" }),
    deployment({ id: "dpl_queued", state: "QUEUED" }),
  ], resolve);
  assert.equal(result.found, false);
  assert.equal(result.refused, true);
  assert.equal(result.retryable, true);
  assert.match(result.reason, /^deployment_not_ready:/);
});
