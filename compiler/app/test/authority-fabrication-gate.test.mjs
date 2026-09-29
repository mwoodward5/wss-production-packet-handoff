import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAuthorityStandard } from "../../factory/authority/authority-standard.mjs";
import { ghostBuildContractForJob } from "../lib/ghost-build-contract.mjs";

// Regression guard for the confirmed gap: evaluateAuthorityStandard() already
// computes real fabrication-adjacent checks ("Claims retain clear source
// citations" / "Quoted reviews are real and attributed") but ghost-build-
// contract.mjs never read authority_summary, so a build failing those checks
// still returned qc_passed:true. These tests prove (a) the checks can
// actually FAIL against constructed bad input (not just PASS/needs-input),
// and (b) the ghost build contract now returns 422/blocked for a build
// carrying a failing authority_standard, while NOT falsely blocking an
// otherwise-clean build.

function baseCtx() {
  return {
    packet: { business: { name: "Cedar Line Landscaping" }, enrichment_sources: {}, media: { catalog: [] }, forge: { demo: true } },
    biz: { name: "Cedar Line Landscaping", city: "Sacramento", state: "CA" },
    services: ["Lawn care"],
    phone: null,
    gbp: {},
    photos: [],
    snippets: [],
  };
}

function pageWith(bodyHtml) {
  return [{ path: "/", title: "Cedar Line Landscaping - Sacramento CA", desc: "d", html: `<html><body>${bodyHtml}</body></html>` }];
}

test("authority check 41/69 FAILS on an unverifiable factual claim with no source_evidence", () => {
  const ctx = baseCtx();
  const result = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: pageWith("<p>We are the award-winning, certified team in town.</p>") });
  const check41 = result.checks.find((c) => c.id === 41);
  assert.equal(check41.status, "failed");
  assert.match(check41.evidence, /no source_evidence/);
});

test("authority check 41/69 PASSES the same claim once source_evidence backs it", () => {
  const ctx = baseCtx();
  ctx.packet.source_evidence = [{ claim: "award-winning", source: "chamber-of-commerce.gov" }];
  const result = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: pageWith("<p>We are the award-winning, certified team in town.</p>") });
  const check41 = result.checks.find((c) => c.id === 41);
  assert.equal(check41.status, "passed");
});

test("authority check 65 FAILS on rendered testimonial markup with zero attributed reviews", () => {
  const ctx = baseCtx();
  const result = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: pageWith('<blockquote class="testimonial">"Best crew ever!" - a happy customer</blockquote>') });
  const check65 = result.checks.find((c) => c.id === 65);
  assert.equal(check65.status, "failed");
});

test("authority check 65 is not_applicable when the page renders no testimonials at all", () => {
  const ctx = baseCtx();
  const result = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: pageWith("<p>Nothing about reviews here.</p>") });
  const check65 = result.checks.find((c) => c.id === 65);
  assert.equal(check65.status, "not_applicable");
});

function validReleaseEvidence() {
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
      expected: { business_name: "Cedar Line Landscaping" },
      actual: { business_name: "Cedar Line Landscaping", public_packet_business_name: "Cedar Line Landscaping", local_business_nodes: 1 },
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: { family: "service-map-pins" },
      actual: { family: "service-map-pins" },
    },
  };
}

function jobWith(authorityStandard) {
  return {
    id: "job_1",
    status: "done",
    ghost_context: { compiled: {}, prospect: {} },
    result: {
      qc: { grade: "A", contract: "public-surface-v2", visual: true, degraded: false },
      preview: "/preview/p1/v1/",
      generation_fingerprint: "fp1",
      release_evidence: validReleaseEvidence(),
      authority_standard: authorityStandard,
    },
  };
}

test("ghost build contract blocks (422) when the authority fabrication checks fail", () => {
  const ctx = baseCtx();
  const failing = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: pageWith("<p>Certified and guaranteed since day one.</p>") });
  const contract = ghostBuildContractForJob({ baseUrl: "https://example.com", job: jobWith(failing) });
  assert.equal(contract.statusCode, 422);
  assert.equal(contract.body.qc_passed, false);
  assert.equal(contract.body.code, "authority_fabrication_check_failed");
});

test("ghost build contract does not report the authority-fabrication code for a build whose authority checks pass", () => {
  const ctx = baseCtx();
  const clean = evaluateAuthorityStandard({ packet: ctx.packet, ctx, pages: pageWith("<p>Reliable local lawn care.</p>") });
  const check41 = clean.checks.find((c) => c.id === 41);
  const check65 = clean.checks.find((c) => c.id === 65);
  assert.notEqual(check41.status, "failed");
  assert.notEqual(check65.status, "failed");
  const contract = ghostBuildContractForJob({ baseUrl: "https://example.com", job: jobWith(clean) });
  assert.equal(contract.statusCode, 200);
  assert.equal(contract.body.qc_passed, true);
});
