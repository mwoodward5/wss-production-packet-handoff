"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { outreachBuildQuality } = require("../lib/email");
const { REQUIRED_QC_CONTRACT, REQUIRED_RENDERER } = require("../lib/siteforge");

const BUSINESS_NAME = "Ready Roofing";
const TEMPLATE_FAMILY = "service-map-pins";

function releaseEvidence() {
  return {
    schema: "siteforge-release-evidence-v1",
    map: {
      verified: true,
      qc_check: { name: "release-map-evidence", detail: "verified" },
      artifact: "screenshots/desktop/map.png",
      evidence_artifact: "screenshots/map-evidence.json",
      manifest_artifact: "screenshots/manifest.json",
      screenshot: { size: 4096, sha256: "c".repeat(64) },
      runtime: {
        response_ok: true,
        geometry_ok: true,
        pixels_ok: true,
        unique_colors: 32,
        variance: 120,
      },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
        { name: "visual-address-map-directions", pass: true, detail: "verified" },
      ],
      screenshot_url: "https://previews.wss-ai.com/ready-roofing/screenshots/desktop/map.png",
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: BUSINESS_NAME },
      actual: {
        business_name: BUSINESS_NAME,
        public_packet_business_name: BUSINESS_NAME,
        local_business_nodes: 1,
      },
      public_packet_url: "https://previews.wss-ai.com/ready-roofing/packet.json",
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: {
        family: TEMPLATE_FAMILY,
        selection: "pinned",
        source: "stage_payload.release_expectation.template_family",
      },
      actual: {
        family: TEMPLATE_FAMILY,
        known_family: true,
        source: "rendered:packet.json#hero_family",
      },
      public_packet_url: "https://previews.wss-ai.com/ready-roofing/packet.json",
    },
  };
}

function releaseReadyProspect(overrides = {}) {
  const evidence = releaseEvidence();
  return {
    prospect_id: "ready-roofing",
    business_name: BUSINESS_NAME,
    preview_url: "https://previews.wss-ai.com/ready-roofing",
    report_url: "https://reports.wss-ai.com/ready-roofing",
    siteforge_renderer: REQUIRED_RENDERER,
    siteforge_generation_fingerprint: "ready-roofing-composition-v8",
    siteforge_qc_contract: REQUIRED_QC_CONTRACT,
    siteforge_qc_passed: true,
    siteforge_visual_qc_passed: true,
    release_evidence: evidence,
    truth_packet: {
      intakeGenie: {
        facts: {
          name: BUSINESS_NAME,
          city: "Irvine",
          state: "CA",
        },
        assets: [],
        evidence: [],
        generation_fingerprint: "ready-roofing-composition-v8",
        release_evidence: evidence,
      },
    },
    ...overrides,
  };
}

test("outreach build quality requires current release evidence in addition to legacy flags", () => {
  const result = outreachBuildQuality(releaseReadyProspect({ release_evidence: null }));
  assert.equal(result.ok, false);
  assert.equal(result.releaseEvidencePassed, false);
  assert.deepEqual(result.reasons, ["release_evidence_missing_or_failed"]);
});

test("outreach build quality rejects a legacy proof envelope even when every old gate passes", () => {
  const legacyEvidence = {
    map_gate: { passed: true, evidence: "https://previews.wss-ai.com/ready-roofing/map.png" },
    preview_identity_gate: {
      passed: true,
      evidence: "https://previews.wss-ai.com/ready-roofing/identity.json",
    },
    template_family_gate: {
      passed: true,
      evidence: "https://previews.wss-ai.com/ready-roofing/template.json",
      actual: TEMPLATE_FAMILY,
      expected: TEMPLATE_FAMILY,
    },
  };
  const result = outreachBuildQuality(releaseReadyProspect({ release_evidence: legacyEvidence }));
  assert.equal(result.ok, false);
  assert.equal(result.releaseEvidencePassed, false);
  assert.ok(result.reasons.includes("release_evidence_missing_or_failed"));
});

test("outreach build quality accepts strict, artifact-backed V1 release evidence", () => {
  const result = outreachBuildQuality(releaseReadyProspect());
  assert.equal(result.ok, true);
  assert.equal(result.releaseEvidencePassed, true);
  assert.deepEqual(result.reasons, []);
});

test("outreach build quality rejects stale same-business evidence from another build", () => {
  const prospect = releaseReadyProspect();
  prospect.siteforge_generation_fingerprint = "ready-roofing-new-composition-v9";
  const result = outreachBuildQuality(prospect);
  assert.equal(result.ok, false);
  assert.equal(result.releaseEvidencePassed, false);
  assert.ok(result.releaseEvidenceFailures.includes("release_evidence_current_build_mismatch"));
});

test("outreach build quality discovers evidence in record callback and dispatch lanes", () => {
  const placements = [
    { record: { release_evidence: releaseEvidence() } },
    { siteforge_callback: { release_evidence: releaseEvidence() } },
    { build_dispatch: { release_evidence: releaseEvidence() } },
    { record: { siteforge_callback: { release_evidence: releaseEvidence() } } },
    { record: { build_dispatch: { release_evidence: releaseEvidence() } } },
  ];
  for (const placement of placements) {
    const result = outreachBuildQuality(releaseReadyProspect({
      release_evidence: null,
      ...placement,
    }));
    assert.equal(result.ok, true, JSON.stringify(placement));
    assert.equal(result.releaseEvidencePassed, true);
  }
});

test("cold module load orders keep the outreach validator and review hold callable", async (t) => {
  const backendRoot = path.resolve(__dirname, "..");
  const prospectJson = JSON.stringify(releaseReadyProspect());
  const cases = [
    [
      "email first",
      `
        const email = require("./lib/email");
        const held = require("./lib/supervised-held-drafts");
      `,
    ],
    [
      "supervised held drafts first",
      `
        const held = require("./lib/supervised-held-drafts");
        const email = require("./lib/email");
      `,
    ],
  ];
  for (const [name, imports] of cases) {
    await t.test(name, () => {
      const script = `
        process.env.GHOST_AGENCY_REVIEW_HOLD = "true";
        ${imports}
        const prospect = ${prospectJson};
        if (typeof email.outreachBuildQuality !== "function") throw new Error("outreachBuildQuality undefined");
        if (typeof email.reviewHoldActive !== "function") throw new Error("reviewHoldActive undefined");
        if (typeof held.phaseOneReleaseEvidence !== "function") throw new Error("phaseOneReleaseEvidence undefined");
        const release = held.phaseOneReleaseEvidence(prospect);
        if (release.ok !== true) throw new Error("strict validator failed: " + release.failures.join(","));
        const quality = email.outreachBuildQuality(prospect);
        if (quality.ok !== true) throw new Error("outreach quality failed: " + quality.reasons.join(","));
        if (email.reviewHoldActive() !== true) throw new Error("review hold not callable");
        process.stdout.write("cold-load-ok");
      `;
      const child = spawnSync(process.execPath, ["-e", script], {
        cwd: backendRoot,
        encoding: "utf8",
      });
      assert.equal(child.status, 0, [child.stdout, child.stderr].filter(Boolean).join("\n"));
      assert.equal(child.stdout, "cold-load-ok");
    });
  }
});

test("outreach build quality rejects wrong schema or an explicitly failed release category", () => {
  const cases = [
    { ...releaseEvidence(), schema: "siteforge-release-evidence-v0" },
    { ...releaseEvidence(), map: { verified: false } },
    { ...releaseEvidence(), identity: { verified: false } },
    { ...releaseEvidence(), template_family: { verified: false } },
  ];
  for (const evidence of cases) {
    const result = outreachBuildQuality(releaseReadyProspect({ release_evidence: evidence }));
    assert.equal(result.ok, false);
    assert.equal(result.releaseEvidencePassed, false);
    assert.ok(result.reasons.includes("release_evidence_missing_or_failed"));
  }
});

test("outreach build quality accepts exact SiteForge advisory waivers bound to the current build", () => {
  const prospect = releaseReadyProspect();
  prospect.release_evidence.map = {
    ...prospect.release_evidence.map,
    verified: false,
    waived: true,
    qc_check: {
      name: "release-map-evidence",
      detail: "advisory: map evidence unverified (waived) — map screenshot, runtime proof, manifest, or supporting map QC is missing or contradictory",
    },
    supporting_checks: [
      { name: "visual-satellite-map-evidence", pass: true, detail: "no confirmed address; satellite map not required" },
      { name: "visual-address-map-directions", pass: true, detail: "no confirmed address; satellite map not required" },
    ],
    manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: false },
  };
  prospect.release_evidence.template_family = {
    verified: true,
    qc_check: {
      name: "release-template-family-match",
      detail: "rendered valid auto-selected template family service-map-pins",
    },
    expected: {
      family: "auto",
      selection: "auto",
      source: "stage_payload.release_expectation.template_family",
    },
    actual: {
      family: "service-map-pins",
      known_family: true,
      source: "rendered:packet.json#hero_family",
    },
  };

  const result = outreachBuildQuality(prospect);
  assert.equal(result.ok, true);
  assert.equal(result.releaseEvidencePassed, true);
});

test("outreach build quality rejects evidence for the wrong business identity", () => {
  const evidence = releaseEvidence();
  evidence.identity.actual.business_name = "Different Roofing Company";
  const result = outreachBuildQuality(releaseReadyProspect({ release_evidence: evidence }));
  assert.equal(result.ok, false);
  assert.equal(result.releaseEvidencePassed, false);
  assert.ok(result.reasons.includes("release_evidence_missing_or_failed"));
});

test("outreach build quality rejects a mismatched template family", () => {
  const evidence = releaseEvidence();
  evidence.template_family.actual.family = "editorial-split";
  const result = outreachBuildQuality(releaseReadyProspect({ release_evidence: evidence }));
  assert.equal(result.ok, false);
  assert.equal(result.releaseEvidencePassed, false);
  assert.ok(result.reasons.includes("release_evidence_missing_or_failed"));
});

test("outreach build quality rejects missing release artifacts or generation fingerprint", async (t) => {
  const cases = [
    ["map screenshot artifact", (prospect) => { delete prospect.release_evidence.map.artifact; }],
    ["map evidence artifact", (prospect) => { delete prospect.release_evidence.map.evidence_artifact; }],
    ["map manifest artifact", (prospect) => { delete prospect.release_evidence.map.manifest_artifact; }],
    ["generation fingerprint", (prospect) => { delete prospect.siteforge_generation_fingerprint; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const prospect = releaseReadyProspect();
      mutate(prospect);
      const result = outreachBuildQuality(prospect);
      assert.equal(result.ok, false);
      assert.equal(result.releaseEvidencePassed, false);
      assert.ok(result.reasons.includes("release_evidence_missing_or_failed"));
    });
  }
});
