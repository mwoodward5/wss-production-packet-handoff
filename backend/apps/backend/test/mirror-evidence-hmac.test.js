"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const test = require("node:test");

const { canonical } = require("../lib/mirror-engine/build-hash");
const {
  EVIDENCE_HMAC_KEY_ENV,
  evidenceHmacConfigured,
  signEvidence,
  verifyEvidence,
} = require("../lib/mirror-engine/evidence-signature");
const { MIRROR_ENGINE_EVIDENCE_SCHEMA } = require("../lib/mirror-engine-contract");
const { mirror } = require("../lib/mirror-engine/engine");

const KEY = "mirror-release-hmac-test-secret-32-bytes-minimum";

function manifest() {
  return {
    ok: true,
    renderer: "mirror-engine@v1",
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: "a".repeat(64),
    preview_url: "https://signed-release.wss-ai.com/",
    revealable: true,
  };
}

test("Mirror release evidence is HMAC-authenticated, not forgeable with its public bytes", () => {
  const evidence = manifest();
  evidence.evidence_sha = signEvidence(evidence, { key: KEY });
  assert.match(evidence.evidence_sha, /^[a-f0-9]{64}$/);
  assert.equal(verifyEvidence(evidence, { key: KEY }), true);
  assert.equal(verifyEvidence({ ...evidence, revealable: false }, { key: KEY }), false);

  const { evidence_sha: _signature, ...unsigned } = evidence;
  const oldPublicChecksum = createHash("sha256")
    .update(canonical({ schema: MIRROR_ENGINE_EVIDENCE_SCHEMA, ...unsigned }))
    .digest("hex");
  assert.equal(
    verifyEvidence({ ...evidence, evidence_sha: oldPublicChecksum }, { key: KEY }),
    false,
    "a release writer that knows only the manifest bytes cannot mint authorization",
  );
});

test("production signing fails closed when the dedicated HMAC key is absent or short", () => {
  for (const env of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", [EVIDENCE_HMAC_KEY_ENV]: "too-short" },
  ]) {
    assert.equal(evidenceHmacConfigured(env), false);
    assert.throws(
      () => signEvidence(manifest(), { env }),
      (error) => error?.code === "mirror_release_evidence_hmac_key_unconfigured"
        && error?.requiredEnv === EVIDENCE_HMAC_KEY_ENV,
    );
    assert.equal(verifyEvidence({ ...manifest(), evidence_sha: "b".repeat(64) }, { env }), false);
  }
});

test("Mirror preflights the production HMAC key before every provider and deploy seam", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const hadKey = Object.prototype.hasOwnProperty.call(process.env, EVIDENCE_HMAC_KEY_ENV);
  const previousKey = process.env[EVIDENCE_HMAC_KEY_ENV];
  const calls = [];
  const touched = (name) => async () => {
    calls.push(name);
    throw new Error(`${name}_must_not_run_without_release_evidence_key`);
  };

  process.env.NODE_ENV = "production";
  delete process.env[EVIDENCE_HMAC_KEY_ENV];
  try {
    const response = await mirror({
      slug: "wss-test-missing-evidence-key",
      donor: "mirror-donor",
      facts: {
        business_name: "Missing Evidence Key Roofing",
        industry: "roofing",
        city: "Tucson",
        state: "AZ",
        phone: "(520) 555-0142",
      },
    }, {
      deps: {
        resolveBrandAssets: touched("resolveBrandAssets"),
        ensureProject: touched("ensureProject"),
        uploadFiles: touched("uploadFiles"),
        createDeployment: touched("createDeployment"),
        renderCheck: touched("renderCheck"),
        renderAudit: touched("renderAudit"),
        sharedPublisher: {
          supportsTwoPhaseQc: true,
          stage: touched("sharedPublisher.stage"),
          activate: touched("sharedPublisher.activate"),
        },
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
    assert.equal(response.body.error, "mirror_release_evidence_hmac_key_unconfigured");
    assert.deepEqual(response.body.detail, [{
      reason: `${EVIDENCE_HMAC_KEY_ENV}_required`,
      required_env: EVIDENCE_HMAC_KEY_ENV,
    }]);
    assert.deepEqual(calls, [], "no provider, publisher, verifier or deploy seam ran");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (hadKey) process.env[EVIDENCE_HMAC_KEY_ENV] = previousKey;
    else delete process.env[EVIDENCE_HMAC_KEY_ENV];
  }
});
