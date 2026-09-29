import assert from "node:assert/strict";
import test from "node:test";

import {
  ghostBuildContractForJob,
  queuedGhostBuildContract,
} from "../lib/ghost-build-contract.mjs";

const BASE_URL = "https://siteforge.example";

function context() {
  return {
    correlation_id: "ghost-job-42",
    prospect: {
      prospect_id: "prospect-42",
      business_name: "North Star Plumbing",
      checkout_url: "https://checkout.example/north-star",
    },
    compiled: {
      version: "truth-packet-v3",
      cache: { hit: true },
      services: ["Drain cleaning"],
    },
    checkout_url: "https://checkout.example/north-star",
  };
}

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
      runtime: { response_ok: true, geometry_ok: true, pixels_ok: true, unique_colors: 32, variance: 120 },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
        { name: "visual-address-map-directions", pass: true, detail: "verified" },
      ],
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: "North Star Plumbing" },
      actual: { business_name: "North Star Plumbing", public_packet_business_name: "North Star Plumbing", local_business_nodes: 1 },
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: { family: "service-map-pins" },
      actual: { family: "service-map-pins" },
    },
  };
}

function entityContext() {
  const value = context();
  value.prospect.city = "Springfield";
  value.prospect.state = "IL";
  value.prospect.website_url = "https://www.northstarplumbing.example/services";
  value.compiled.intakeGenie = {
    facts: {
      name: "North Star Plumbing",
      city: "Springfield",
      state: "IL",
      website: "https://northstarplumbing.example/",
    },
  };
  return value;
}

function entityReleaseEvidence() {
  const evidence = releaseEvidence();
  evidence.identity.expected = {
    business_name: "North Star Plumbing",
    city: "Springfield",
    state: "IL",
    source_website: "https://northstarplumbing.example/",
  };
  evidence.identity.actual = {
    ...evidence.identity.actual,
    city: "Springfield",
    public_packet_city: "Springfield",
    state: "IL",
    public_packet_state: "IL",
    source_website: "https://northstarplumbing.example/contact",
    public_packet_source_website: "https://www.northstarplumbing.example/",
  };
  return evidence;
}

function completedEntityJob(evidence) {
  return {
    id: "sf-job-entity",
    status: "done",
    correlation_id: "ghost-job-entity",
    ghost_context: entityContext(),
    result: {
      preview: "/try/north-star-plumbing/",
      generation_fingerprint: "f".repeat(64),
      authority_standard: passingAuthorityStandard(),
      release_evidence: evidence,
      qc: {
        grade: "A",
        score: 98,
        degraded: false,
        visual: true,
        contract: "public-surface-v2",
      },
    },
  };
}

// The 108-Point Authority Standard's fabrication-relevant checks (41, 65, 69)
// are folded into qc_passed (see ghost-build-contract.mjs). These fixtures
// were written before that gate existed, so a fixture that expects a 200
// must carry a passing authority_standard.checks array — mirroring what the
// real pipeline always attaches via packet.authority_standard.
function passingAuthorityStandard() {
  return {
    standard: "authority-108-v1",
    total: 108,
    checks: [
      { id: 41, key: "aeo-and-geo-41", status: "passed" },
      { id: 65, key: "trust-and-e-e-a-t-65", status: "not_applicable" },
      { id: 69, key: "trust-and-e-e-a-t-69", status: "passed" },
    ],
  };
}

test("queued Ghost builds expose one resumable authenticated status URL and no artifact URLs", () => {
  const contract = queuedGhostBuildContract({
    baseUrl: BASE_URL,
    job: { id: "sf-job-42" },
    compiled: context().compiled,
    correlationId: "ghost-job-42",
  });

  assert.equal(contract.statusCode, 202);
  assert.equal(contract.body.pending, true);
  assert.equal(contract.body.job_id, "sf-job-42");
  assert.equal(contract.body.correlation_id, "ghost-job-42");
  assert.equal(contract.body.status_url, `${BASE_URL}/api/ghost-agency/build-preview/sf-job-42`);
  assert.equal(contract.body.preview_url, undefined);
  assert.equal(contract.body.report_url, undefined);
});

test("completed Ghost builds return the exact V8 public-surface contract", () => {
  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: {
      id: "sf-job-42",
      status: "done",
      correlation_id: "ghost-job-42",
      ghost_context: context(),
      result: {
        preview: "/try/north-star-plumbing/",
        generation_fingerprint: "a".repeat(64),
        authority_standard: passingAuthorityStandard(),
        release_evidence: releaseEvidence(),
        qc: {
          grade: "A",
          score: 98,
          degraded: false,
          visual: true,
          contract: "public-surface-v2",
        },
      },
    },
  });

  assert.equal(contract.statusCode, 200);
  assert.equal(contract.body.ok, true);
  assert.equal(contract.body.renderer, "05-build-v8");
  assert.equal(contract.body.qc_passed, true);
  assert.equal(contract.body.visual_qc_passed, true);
  assert.equal(contract.body.preview_url, `${BASE_URL}/try/north-star-plumbing/`);
  assert.equal(contract.body.report_url, `${BASE_URL}/try/north-star-plumbing/scorecard.json`);
  assert.equal(contract.body.release_evidence.map.screenshot_url, `${BASE_URL}/try/north-star-plumbing/screenshots/desktop/map.png`);
  assert.equal(contract.body.release_evidence.identity.public_packet_url, `${BASE_URL}/try/north-star-plumbing/packet.json`);
  assert.deepEqual(contract.body.payload.prospect.release_evidence, contract.body.release_evidence);
  assert.deepEqual(contract.body.payload.truth_packet.release_evidence, contract.body.release_evidence);
  assert.equal(contract.body.authority_summary.total, 108);
  assert.equal(contract.body.payload.prospect.checkout_url, "https://checkout.example/north-star");
});

test("failed visual QC returns no preview or report URL", () => {
  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: {
      id: "sf-job-blocked",
      status: "done",
      ghost_context: context(),
      result: {
        preview: "/try/blocked/",
        generation_fingerprint: "b".repeat(64),
        authority_standard: passingAuthorityStandard(),
        release_evidence: releaseEvidence(),
        qc: {
          grade: "B",
          score: 82,
          degraded: false,
          visual: false,
          contract: "public-surface-v2",
        },
      },
    },
  });

  assert.equal(contract.statusCode, 422);
  assert.equal(contract.body.ok, false);
  assert.equal(contract.body.preview_url, null);
  assert.equal(contract.body.report_url, null);
  assert.deepEqual(contract.body.urls, {});
  assert.equal(contract.body.code, "visual_qc_incomplete");
});

test("explicit readiness-only project pre-certification remains Grade B and is deliverable", () => {
  const job = {
    id: "sf-job-precertified",
    status: "done",
    ghost_context: context(),
    result: {
      preview: "/try/precertified/",
      generation_fingerprint: "c".repeat(64),
      authority_standard: passingAuthorityStandard(),
      release_evidence: releaseEvidence(),
      qc: {
        grade: "B",
        score: 98,
        degraded: false,
        visual: true,
        contract: "public-surface-v2",
        precertified: true,
        precertification_policy: "project-precertification",
      },
    },
  };

  const accepted = ghostBuildContractForJob({ baseUrl: BASE_URL, job });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.qc_passed, true);
  assert.equal(accepted.body.grade, "B");
  assert.equal(accepted.body.precertified, true);
  assert.match(accepted.body.preview_url, /\/try\/precertified\/$/);

  job.result.qc.precertification_policy = "unrecognized-policy";
  const blocked = ghostBuildContractForJob({ baseUrl: BASE_URL, job });
  assert.equal(blocked.statusCode, 422);
  assert.equal(blocked.body.qc_passed, false);
  assert.equal(blocked.body.precertified, false);
  assert.equal(blocked.body.preview_url, null);
});

test("waived advisory map and family evidence is accepted; identity stays fail-closed", () => {
  // Minimum-QC policy: a waived section carries waived: true, verified: false,
  // and the REAL unverified capture data (screenshot honestly null, frozen-map
  // runtime numbers as measured) — never fabricated proof.
  const waivedEvidence = () => {
    const evidence = releaseEvidence();
    evidence.map = {
      verified: false,
      waived: true,
      qc_check: { name: "release-map-evidence", detail: "advisory: map evidence unverified (waived) — map screenshot, runtime proof, manifest, or supporting map QC is missing or contradictory" },
      artifact: "screenshots/desktop/map.png",
      evidence_artifact: "screenshots/map-evidence.json",
      manifest_artifact: "screenshots/manifest.json",
      screenshot: null,
      runtime: { response_ok: true, geometry_ok: false, pixels_ok: false, unique_colors: 1, variance: 0 },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: false },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: false, detail: "map capture frozen in serverless chromium" },
        { name: "visual-address-map-directions", pass: true, detail: "address confirmed" },
      ],
    };
    evidence.template_family = {
      verified: false,
      waived: true,
      qc_check: { name: "release-template-family-match", detail: "advisory: template family unverified (waived); expected=auto; rendered=service-map-pins" },
      expected: { family: "auto" },
      actual: { family: "service-map-pins" },
    };
    return evidence;
  };
  const jobFor = (evidence) => ({
    id: "sf-job-waived",
    status: "done",
    ghost_context: context(),
    result: {
      preview: "/try/waived/",
      generation_fingerprint: "e".repeat(64),
      authority_standard: passingAuthorityStandard(),
      release_evidence: evidence,
      qc: { grade: "A", score: 96, degraded: false, visual: true, contract: "public-surface-v2" },
    },
  });

  const accepted = ghostBuildContractForJob({ baseUrl: BASE_URL, job: jobFor(waivedEvidence()) });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.qc_passed, true);
  assert.equal(accepted.body.release_evidence.map.waived, true);
  assert.equal(accepted.body.release_evidence.map.verified, false);
  assert.equal(accepted.body.release_evidence.map.screenshot, null);
  assert.equal(accepted.body.release_evidence.template_family.waived, true);

  const wrongBusiness = waivedEvidence();
  wrongBusiness.identity.actual.business_name = "Different Plumbing";
  const blocked = ghostBuildContractForJob({ baseUrl: BASE_URL, job: jobFor(wrongBusiness) });
  assert.equal(blocked.statusCode, 422);
  assert.equal(blocked.body.code, "release_evidence_incomplete");

  // A waived flag is not a bypass for identity: identity never waives.
  const waivedIdentity = waivedEvidence();
  waivedIdentity.identity.waived = true;
  waivedIdentity.identity.verified = false;
  const alsoBlocked = ghostBuildContractForJob({ baseUrl: BASE_URL, job: jobFor(waivedIdentity) });
  assert.equal(alsoBlocked.statusCode, 422);
  assert.equal(alsoBlocked.body.code, "release_evidence_incomplete");
});

test("verified auto-selected built-in family is accepted only with concrete SiteForge selection proof", () => {
  const autoEvidence = entityReleaseEvidence();
  autoEvidence.template_family = {
    verified: true,
    qc_check: { name: "release-template-family-match", detail: "rendered valid auto-selected template family service-map-pins" },
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
  const job = completedEntityJob(autoEvidence);
  job.result.preview = "/try/auto-selected/";

  const accepted = ghostBuildContractForJob({ baseUrl: BASE_URL, job });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.release_evidence.template_family.verified, true);
  assert.equal(accepted.body.release_evidence.template_family.expected.family, "auto");
  assert.equal(accepted.body.release_evidence.template_family.actual.family, "service-map-pins");

  for (const mutate of [
    (evidence) => { evidence.template_family.actual.known_family = false; },
    (evidence) => { evidence.template_family.expected.selection = "pinned"; },
    (evidence) => { evidence.template_family.actual.source = "untrusted-source"; },
  ]) {
    const invalidEvidence = structuredClone(autoEvidence);
    mutate(invalidEvidence);
    const blocked = ghostBuildContractForJob({
      baseUrl: BASE_URL,
      job: completedEntityJob(invalidEvidence),
    });
    assert.equal(blocked.statusCode, 422);
    assert.equal(blocked.body.code, "release_evidence_incomplete");
  }
});

test("same-name entity with the wrong rendered state fails closed", () => {
  const evidence = entityReleaseEvidence();
  evidence.identity.actual.state = "MO";
  evidence.identity.actual.public_packet_state = "MO";

  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: completedEntityJob(evidence),
  });

  assert.equal(contract.statusCode, 422);
  assert.equal(contract.body.qc_passed, false);
  assert.equal(contract.body.code, "release_evidence_incomplete");
  assert.equal(contract.body.preview_url, null);
});

test("same-name entity with the wrong rendered source host fails closed", () => {
  const evidence = entityReleaseEvidence();
  evidence.identity.actual.source_website = "https://northstarplumbing.example/";
  evidence.identity.actual.public_packet_source_website = "https://northstarplumbing-missouri.example/";

  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: completedEntityJob(evidence),
  });

  assert.equal(contract.statusCode, 422);
  assert.equal(contract.body.qc_passed, false);
  assert.equal(contract.body.code, "release_evidence_incomplete");
  assert.equal(contract.body.preview_url, null);
});

test("the correct same-name entity passes city, state, and source-host binding", () => {
  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: completedEntityJob(entityReleaseEvidence()),
  });

  assert.equal(contract.statusCode, 200);
  assert.equal(contract.body.qc_passed, true);
  assert.equal(contract.body.preview_url, `${BASE_URL}/try/north-star-plumbing/`);
});

test("completed Ghost builds fail closed when release evidence is absent", () => {
  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: {
      id: "sf-job-unproved",
      status: "done",
      ghost_context: context(),
      result: {
        preview: "/try/unproved/",
        generation_fingerprint: "d".repeat(64),
        qc: { grade: "A", score: 100, degraded: false, visual: true, contract: "public-surface-v2" },
      },
    },
  });

  assert.equal(contract.statusCode, 422);
  assert.equal(contract.body.code, "release_evidence_incomplete");
  assert.equal(contract.body.preview_url, null);
  assert.equal(contract.body.release_evidence, null);
});

test("terminal durable failures remain blocked and never invent artifact URLs", () => {
  const contract = ghostBuildContractForJob({
    baseUrl: BASE_URL,
    job: {
      id: "sf-job-failed",
      status: "blocked",
      error_code: "visual_qc_incomplete",
      error: "Visual QC did not pass.",
      ghost_context: context(),
    },
  });

  assert.equal(contract.statusCode, 422);
  assert.equal(contract.body.code, "visual_qc_incomplete");
  assert.equal(contract.body.preview_url, undefined);
  assert.equal(contract.body.report_url, undefined);
});
