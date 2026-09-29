"use strict";

// Finding 3: two production deployments can legitimately share one operation
// tag when a timed/interrupted build was retried on the SAME durable key. The
// resolver used to refuse both as "deployment_metadata_ambiguous" (a 502 that
// never retried out and exhausted the budget — the live resume_refused cluster).
// It now takes the newest READY twin; project-isolation + identity checks still
// run on the chosen candidate.
process.env.VERCEL_TOKEN = process.env.VERCEL_TOKEN || "test-token";
process.env.VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID || "team_test";

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveTaggedDeployment } = require("../lib/mirror-engine/deploy");

function dep(uid, readyState) {
  return {
    uid,
    url: `${uid.replace(/_/g, "-")}.vercel.app`,
    readyState,
    projectId: "prj_customer_x",
    name: "metro-fence-customer",
    meta: { operation_key_hmac_sha256: "op123", build_hash: "bh456" },
  };
}
function mockFetch(deployments) {
  return async () => ({ ok: true, status: 200, json: async () => ({ deployments }) });
}
const KEY = { projectId: "prj_customer_x", buildHash: "bh456", operationKeyHmacSha256: "op123" };

test("two READY twins resolve to the newest (v6 list is newest-first), not ambiguous", async () => {
  const orig = global.fetch;
  global.fetch = mockFetch([dep("dpl_new", "READY"), dep("dpl_old", "READY")]);
  try {
    const r = await resolveTaggedDeployment(KEY);
    assert.equal(r.found, true, `expected found; got ${JSON.stringify(r)}`);
    assert.equal(r.deployment.id, "dpl_new");
  } finally { global.fetch = orig; }
});

test("newest BUILDING, older READY resolves to the READY one", async () => {
  const orig = global.fetch;
  global.fetch = mockFetch([dep("dpl_building", "BUILDING"), dep("dpl_ready", "READY")]);
  try {
    const r = await resolveTaggedDeployment(KEY);
    assert.equal(r.found, true, `expected found; got ${JSON.stringify(r)}`);
    assert.equal(r.deployment.id, "dpl_ready");
  } finally { global.fetch = orig; }
});

test("no READY twin stays retryable (deployment_not_ready), never ambiguous", async () => {
  const orig = global.fetch;
  global.fetch = mockFetch([dep("dpl_q2", "QUEUED"), dep("dpl_q1", "BUILDING")]);
  try {
    const r = await resolveTaggedDeployment(KEY);
    assert.equal(r.found, false);
    assert.equal(r.retryable, true);
    assert.match(String(r.reason), /^deployment_not_ready:/);
  } finally { global.fetch = orig; }
});
