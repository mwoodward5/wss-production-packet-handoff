"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { signEvidence } = require("../lib/mirror-engine/engine");
const {
  MIRROR_ENGINE_RENDERER,
  MIRROR_ENGINE_QC_CONTRACT,
  MIRROR_ENGINE_EVIDENCE_SCHEMA,
} = require("../lib/siteforge");
const { nativeMirrorBuildEvidence } = require("../lib/line-adapters");

const PREVIEW = "https://wss-test-grass-works-leander.wss-ai.com/";

// Build a real signed manifest exactly the way the mirror engine does: stamp
// renderer/qc_contract/evidence_schema, set revealable, then compute
// evidence_sha over the full object with signEvidence.
function signedManifest(overrides = {}) {
  const manifest = {
    ok: true,
    dry_run: false,
    renderer: MIRROR_ENGINE_RENDERER,
    qc_contract: MIRROR_ENGINE_QC_CONTRACT,
    evidence_schema: MIRROR_ENGINE_EVIDENCE_SCHEMA,
    build_hash: "4cf94825d93b9aba41993520def6e5e3a9174b6ea1042f72deea98560f403aa9",
    donor: "grassworks",
    donor_content_hash: "donorhash",
    slug: "grass-works-leander",
    file_count: 18,
    logo_sha: "abc",
    checks: {},
    polish_flags: {},
    revealable: true,
    preview_url: PREVIEW,
    ...overrides,
  };
  manifest.evidence_sha = signEvidence(manifest);
  return manifest;
}

// A dispatch object shaped like dispatchMirrorLane's happy-path output.
function dispatchWith(manifest) {
  return {
    mode: "mirror_lane",
    pending: false,
    urls: { preview_url: PREVIEW, report_url: "" },
    build_hash: manifest.build_hash,
    renderer: manifest.renderer,
    qc_contract: manifest.qc_contract,
    evidence_schema: manifest.evidence_schema,
    evidence_sha: manifest.evidence_sha,
    release_evidence: manifest,
    releaseEvidence: manifest,
    buildStatus: {
      ready: true,
      pending: false,
      renderer: manifest.renderer,
      required_renderer: MIRROR_ENGINE_RENDERER,
      qc_contract: manifest.qc_contract,
      required_qc_contract: MIRROR_ENGINE_QC_CONTRACT,
      evidence_schema: manifest.evidence_schema,
      evidence_sha: manifest.evidence_sha,
      release_evidence: manifest,
      qc_passed: true,
      visual_qc_passed: true,
      blocked: [],
      generation_fingerprint: `mirror-engine:${manifest.build_hash}`,
      mirror: { donor: manifest.donor, vertical: "plumbing", photos: 4, content: 1 },
    },
  };
}

test("valid signed build passes evidence verification", () => {
  const dispatch = dispatchWith(signedManifest());
  const res = nativeMirrorBuildEvidence(dispatch, PREVIEW);
  assert.equal(res.native, true);
  assert.equal(res.reason, "");
  assert.ok(res.evidence, "evidence should be present for a valid signed build");
  assert.equal(res.evidence.qc_passed, true);
});

test("successful build with a tampered signature ships as unverified, not killed", () => {
  const manifest = signedManifest();
  // Flip one byte of the signature. signedMirrorReleaseEvidence will reject it
  // (signature no longer matches), but the build DID produce a valid preview URL.
  manifest.evidence_sha = "0".repeat(64);
  const dispatch = dispatchWith(manifest);
  const res = nativeMirrorBuildEvidence(dispatch, PREVIEW);
  assert.equal(res.native, true);
  assert.equal(res.reason, "", "a successful build must not carry a failure reason");
  assert.equal(res.evidence, null);
  assert.equal(res.beforeBuild, false, "must not be mislabeled as a before-build failure");
  assert.equal(res.unverifiedEvidence, true);
  assert.deepEqual(res.unverifiedReasons, ["release_evidence_signature_invalid"]);
});

test("build that never ran (no preview URL) is a genuine before-build failure", () => {
  // Tampered evidence AND no preview URL: the build never produced a URL, so it
  // is a genuine before-build failure, not an unverified-but-shipped build.
  const manifest = signedManifest();
  manifest.evidence_sha = "0".repeat(64);
  const dispatch = dispatchWith(manifest);
  const res = nativeMirrorBuildEvidence({ ...dispatch, urls: {} }, "");
  assert.equal(res.native, true);
  assert.equal(res.evidence, null);
  assert.equal(res.reason, "mirror_engine_release_evidence_invalid");
});

test("a build whose evidence failed the preview-URL check ships as unverified, not killed", () => {
  // Valid signature, but the evidence's preview_url points somewhere else.
  // signedMirrorReleaseEvidence rejects on the URL mismatch.
  const manifest = signedManifest({ preview_url: "https://wss-test-something-else.wss-ai.com/" });
  // Re-sign because we changed preview_url AFTER signing — that produces a
  // signature that no longer matches, simulating a genuine URL/shape mismatch.
  const dispatch = dispatchWith(manifest);
  const res = nativeMirrorBuildEvidence(dispatch, PREVIEW);
  assert.equal(res.reason, "", "build produced a valid URL — must not be killed");
  assert.equal(res.beforeBuild, false);
  assert.equal(res.unverifiedEvidence, true);
});
