"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { canBypassReviewHold } = require("../lib/email");
const { persistedBuild } = require("../api/admin/owner-smoke");

test("owner email proof uses the verified outreach sender and go.wss-ai.com report URL", () => {
  const source = fs.readFileSync(path.join(__dirname, "../api/proof/owner-email-smoke.js"), "utf8");
  assert.match(source, /const reportUrl = "https:\/\/go\.wss-ai\.com\/report"/);
  assert.match(source, /sendResendEmail\(\{[\s\S]*?senderKind: "outreach"/);
  assert.doesNotMatch(source, /woodward-ghost-agency-vercel\.vercel\.app\/report/);
});

test("owner-only smoke can bypass the review hold only with internal proof and the exact configured owner", () => {
  const previousOwner = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = "woodwardsoftware@gmail.com";
  try {
    assert.equal(canBypassReviewHold({
      to: "woodwardsoftware@gmail.com",
      allowReviewHoldBypass: true,
      internalOwnerProof: true,
    }), true);
    assert.equal(canBypassReviewHold({
      to: "prospect@example.com",
      allowReviewHoldBypass: true,
      internalOwnerProof: true,
    }), false);
    assert.equal(canBypassReviewHold({
      to: "woodwardsoftware@gmail.com",
      allowReviewHoldBypass: true,
      internalOwnerProof: false,
    }), false);
  } finally {
    if (previousOwner === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = previousOwner;
  }

  const script = fs.readFileSync(path.join(__dirname, "../scripts/supervised-five-owner-smoke.js"), "utf8");
  assert.match(script, /allowReviewHoldBypass:\s*true/);
  assert.match(script, /internalOwnerProof:\s*true/);
});

test("owner smoke mirrors durable nested artifact URLs when legacy columns are null", () => {
  const build = persistedBuild({
    prospect_id: "nested-url-proof",
    business_name: "Nested URL Proof",
    preview_url: null,
    report_url: null,
    record: {
      preview_url: "https://previews.wss-ai.com/nested-url-proof",
      report_url: "https://reports.wss-ai.com/nested-url-proof",
      siteforge_renderer: "05-build-v8",
      siteforge_generation_fingerprint: "nested-url-proof-v8",
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      release_evidence: {
        schema: "siteforge-release-evidence-v1",
        map: { verified: true },
        identity: { verified: true },
        template_family: { verified: true },
      },
    },
  });
  assert.equal(build.preview_url, "https://previews.wss-ai.com/nested-url-proof");
  assert.equal(build.report_url, "https://reports.wss-ai.com/nested-url-proof");
});
