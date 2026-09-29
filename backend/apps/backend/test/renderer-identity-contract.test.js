"use strict";

// The renderer-identity contract (divergence audit, 2026-07-29):
//   1. Renderer identity comes from the renderer's persisted result.
//   2. Ghost may not overwrite renderer identity.
//   3. QC evidence identifies who issued it.
//   4. Forge output has a first-class Forge contract or stays blocked.
//   5. Nothing is sendable without authentic renderer AND QC evidence.

const test = require("node:test");
const assert = require("node:assert/strict");

const siteforge = require("../lib/siteforge");
const forge = require("../lib/forge");
const reclassify = require("../api/admin/reclassify-forge-evidence");
const { outreachBuildQuality } = require("../lib/email");

test("forge identity constants are defined by the renderer and re-exported unchanged", () => {
  assert.equal(forge.FORGE_MIRROR_RENDERER, "ghost-forge-mirror-v1");
  assert.equal(forge.FORGE_MIRROR_QC_CONTRACT, "ghost-forge-audit-v1");
  assert.equal(siteforge.FORGE_MIRROR_RENDERER, forge.FORGE_MIRROR_RENDERER);
  assert.equal(siteforge.FORGE_MIRROR_QC_CONTRACT, forge.FORGE_MIRROR_QC_CONTRACT);
  assert.equal(siteforge.FORGE_RELEASE_EVIDENCE_SCHEMA, "ghost-forge-release-evidence-v1");
});

test("acceptedRendererPair accepts coherent pairs and rejects cross-stamping", () => {
  const { acceptedRendererPair, REQUIRED_RENDERER, REQUIRED_QC_CONTRACT, FORGE_MIRROR_RENDERER, FORGE_MIRROR_QC_CONTRACT } = siteforge;
  assert.equal(acceptedRendererPair(REQUIRED_RENDERER, REQUIRED_QC_CONTRACT), true);
  assert.equal(acceptedRendererPair(FORGE_MIRROR_RENDERER, FORGE_MIRROR_QC_CONTRACT), true);
  // Cross-stamping is the impersonation this contract ends.
  assert.equal(acceptedRendererPair(FORGE_MIRROR_RENDERER, REQUIRED_QC_CONTRACT), false);
  assert.equal(acceptedRendererPair(REQUIRED_RENDERER, FORGE_MIRROR_QC_CONTRACT), false);
  assert.equal(acceptedRendererPair("unknown-renderer", REQUIRED_QC_CONTRACT), false);
  assert.equal(acceptedRendererPair("", ""), false);
});

test("forgeReleaseEvidence identifies its issuer and what it proved", () => {
  const job = {
    deploy: { alias: "https://practical-plumbing-killeen.wss-ai.com" },
    input: { boilerplate: "roofing-riseabove" },
    deployedFilesHydratedAt: "2026-07-29T00:00:00.000Z",
  };
  const audit = { verdict: "PASS", blocking: 0, findings: [] };
  const ev = forge.forgeReleaseEvidence({ job, audit });
  assert.equal(ev.schema, "ghost-forge-release-evidence-v1");
  assert.equal(ev.renderer, "ghost-forge-mirror-v1");
  assert.equal(ev.qc_contract, "ghost-forge-audit-v1");
  assert.equal(ev.verdict, "PASS");
  assert.equal(ev.deploy_alias, "https://practical-plumbing-killeen.wss-ai.com");
});

test("a forge-signed artifact with coherent evidence is sendable under ITS OWN name", () => {
  const alias = "https://practical-plumbing-killeen.wss-ai.com";
  const job = { deploy: { alias }, input: { boilerplate: "x" }, deployedFilesHydratedAt: "t" };
  const audit = { verdict: "PASS", blocking: 0, findings: [], renderer: forge.FORGE_MIRROR_RENDERER, qc_contract: forge.FORGE_MIRROR_QC_CONTRACT };
  const evidence = forge.forgeReleaseEvidence({ job, audit });
  const prospect = {
    preview_url: `${alias}`,
    record: {
      siteforge_renderer: forge.FORGE_MIRROR_RENDERER,
      siteforge_qc_contract: forge.FORGE_MIRROR_QC_CONTRACT,
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      build_dispatch: { release_evidence: evidence },
    },
  };
  const q = outreachBuildQuality(prospect);
  assert.deepEqual(q.reasons, []);
  assert.equal(q.ok, true);
});

test("forge output wearing SiteForge's QC contract is NOT sendable", () => {
  const alias = "https://practical-plumbing-killeen.wss-ai.com";
  const evidence = forge.forgeReleaseEvidence({ job: { deploy: { alias } }, audit: { verdict: "PASS", blocking: 0 } });
  const prospect = {
    preview_url: alias,
    record: {
      siteforge_renderer: forge.FORGE_MIRROR_RENDERER,
      siteforge_qc_contract: siteforge.REQUIRED_QC_CONTRACT, // cross-stamped
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      build_dispatch: { release_evidence: evidence },
    },
  };
  const q = outreachBuildQuality(prospect);
  assert.equal(q.ok, false);
});

test("a blocked forge audit is never sendable, even with evidence present", () => {
  const alias = "https://x.wss-ai.com";
  const evidence = forge.forgeReleaseEvidence({ job: { deploy: { alias } }, audit: { verdict: "BLOCKED", blocking: 2 } });
  const prospect = {
    preview_url: alias,
    record: {
      siteforge_renderer: forge.FORGE_MIRROR_RENDERER,
      siteforge_qc_contract: forge.FORGE_MIRROR_QC_CONTRACT,
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      build_dispatch: { release_evidence: evidence },
    },
  };
  const q = outreachBuildQuality(prospect);
  assert.equal(q.ok, false);
  assert.ok(q.reasons.includes("forge_audit_blocked"));
});

test("a forge artifact whose deploy alias does not match the preview is NOT sendable", () => {
  const evidence = forge.forgeReleaseEvidence({
    job: { deploy: { alias: "https://someone-else.wss-ai.com" } },
    audit: { verdict: "PASS", blocking: 0 },
  });
  const prospect = {
    preview_url: "https://practical-plumbing-killeen.wss-ai.com",
    record: {
      siteforge_renderer: forge.FORGE_MIRROR_RENDERER,
      siteforge_qc_contract: forge.FORGE_MIRROR_QC_CONTRACT,
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      build_dispatch: { release_evidence: evidence },
    },
  };
  const q = outreachBuildQuality(prospect);
  assert.equal(q.ok, false);
  assert.ok(q.reasons.includes("forge_deploy_alias_preview_mismatch"));
});

test("reclassification targets exactly the impersonated rows and is idempotent", () => {
  const impersonated = {
    siteforge_generation_fingerprint: "forge-job:2026-07-28T00:00:00.000Z",
    siteforge_renderer: siteforge.REQUIRED_RENDERER,
    siteforge_qc_contract: siteforge.REQUIRED_QC_CONTRACT,
    forge_job: { deploy: { alias: "https://x.wss-ai.com" }, audit: { verdict: "PASS", blocking: 0 } },
    build_dispatch: { renderer: siteforge.REQUIRED_RENDERER, qc_contract: siteforge.REQUIRED_QC_CONTRACT },
  };
  assert.equal(reclassify.isImpersonated(impersonated), true);

  // Genuine SiteForge evidence (no forge-job fingerprint) is untouched.
  assert.equal(reclassify.isImpersonated({
    siteforge_generation_fingerprint: "sf-真-abc123",
    siteforge_renderer: siteforge.REQUIRED_RENDERER,
  }), false);

  const next = reclassify.reclassifyRecord(impersonated);
  assert.equal(next.siteforge_renderer, forge.FORGE_MIRROR_RENDERER);
  assert.equal(next.siteforge_qc_contract, forge.FORGE_MIRROR_QC_CONTRACT);
  assert.equal(next.build_dispatch.renderer, forge.FORGE_MIRROR_RENDERER);
  assert.equal(next.build_dispatch.release_evidence.schema, "ghost-forge-release-evidence-v1");
  // Idempotent: the rewritten record no longer matches the selector.
  assert.equal(reclassify.isImpersonated(next), false);
});
