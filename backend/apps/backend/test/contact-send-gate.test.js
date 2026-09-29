"use strict";

// End-to-end coverage (real lib/email.js + lib/contact-enrichment.js, no
// mocks) proving the audited gap is actually closed: a prospect whose
// contact_enrichment verdict flags a suppressed/conflicting/low-confidence
// address is refused by sendSequenceStep even though a raw `email` field is
// present and non-empty — the exact scenario run-campaign.js's
// `prospect.email || prospect.ownerEmail || prospect.owner_email` selection
// used to sail straight through.

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");
const { enrichContactEvidence } = require("../lib/contact-enrichment");
const { proofEmailV3Enabled } = require("../lib/proof-email-inputs");

const originalEnv = { ...process.env };
function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
}
afterEach(restoreEnvironment);

function baseEnv() {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  // No SUPABASE_* / RESEND_API_KEY on purpose: dryRun composition must not
  // require live infrastructure, and this also proves the new gate runs
  // before any network dependency.
}

// PROOF-FIRST FIXTURE NOTE (2026-07-31).
//
// Every prospect below now also carries `current_website` and
// `before_shot_source_url`. Nothing in this file's assertions changed — the
// contact-hold gate and its owner-proof bypass are asserted exactly as they
// were. What changed is upstream of them: lib/email.js refuses to compose
// sequence 1 unless the before/after comparison exists AND the "before" shot is
// recorded as having been captured from the prospect's OWN registrable domain
// (see test/before-image-identity.test.js). A fixture with a preview but no
// current website is no longer a sendable prospect in any lane, so these tests
// have to supply that evidence before they can reach the gate they are about.
// This is the strengthened contract supplied, not an assertion relaxed — the
// same move test/security-contracts.test.js recorded for its own fixture.
const CURRENT_SITE = "https://example-business-site.example/";
const BEFORE_SHOT_SOURCE = "https://www.example-business-site.example/home";

function slugFor(businessName) {
  // A preview slug that STARTS WITH the business-name tokens passes
  // previewIdentityMatchesProspect (it is unrelated to the contact-hold gate
  // under test, but every send has to clear it first).
  return businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function strictReleaseEvidence({ businessName, previewUrl, family = "service-map-pins" }) {
  const publicBaseUrl = previewUrl.replace(/\/+$/, "");
  const publicPacketUrl = `${publicBaseUrl}/packet.json`;
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
      screenshot_url: `${publicBaseUrl}/screenshots/desktop/map.png`,
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: businessName },
      actual: {
        business_name: businessName,
        public_packet_business_name: businessName,
        local_business_nodes: 1,
      },
      public_packet_url: publicPacketUrl,
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: { family },
      actual: { family },
      public_packet_url: publicPacketUrl,
    },
  };
}

function currentBuildProof({ businessName, previewUrl }) {
  const generationFingerprint = `${slugFor(businessName)}-composition-v8`;
  const releaseEvidence = strictReleaseEvidence({ businessName, previewUrl });
  return {
    siteforge_renderer: "05-build-v8",
    siteforge_generation_fingerprint: generationFingerprint,
    siteforge_qc_passed: true,
    siteforge_visual_qc_passed: true,
    siteforge_qc_contract: "public-surface-v2",
    release_evidence: releaseEvidence,
    truth_packet: {
      intakeGenie: {
        facts: { name: businessName },
        assets: [],
        evidence: [],
        generation_fingerprint: generationFingerprint,
        release_evidence: releaseEvidence,
      },
    },
  };
}

function minedLeadShape({ prospectId, email, holdReasonsOverride } = {}) {
  // Mirrors exactly what lib/lead-miner.js rowFromPlace() writes on a prospect
  // row when a business's own website has a scrapable email: reachability is
  // never verified, so review_hold is always true — this must NOT block.
  const contactEnrichment = enrichContactEvidence({
    sources: { website: { url: "https://example-business.test", email, confidence: 0.8, email_reachable: null } },
  });
  const businessName = "Example Business";
  const previewUrl = `https://preview.wss-ai.com/try/${slugFor(businessName)}/`;
  return {
    prospect_id: prospectId,
    business_name: businessName,
    email,
    city: "Irvine",
    industry: "landscaping",
    report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
    preview_url: previewUrl,
    current_website: CURRENT_SITE,
    before_shot_source_url: BEFORE_SHOT_SOURCE,
    ...currentBuildProof({ businessName, previewUrl }),
    contact_enrichment: contactEnrichment,
    outreach_review_hold: contactEnrichment.outreach.review_hold,
    outreach_hold_reasons: holdReasonsOverride || contactEnrichment.outreach.hold_reasons,
  };
}

test("sendSequenceStep composes normally for a real mined lead even though review_hold is true (reachability merely unverified)", async () => {
  baseEnv();
  const { sendSequenceStep } = require("../lib/email");
  const result = await sendSequenceStep({
    prospect: minedLeadShape({ prospectId: "lead-clean-1", email: "info@example-business.test" }),
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.blocked, undefined);
});

test("sendSequenceStep refuses a prospect whose enrichment verdict flags a suppressed/conflicting address, even with a non-empty raw email", async () => {
  baseEnv();
  const { sendSequenceStep } = require("../lib/email");
  const contactEnrichment = enrichContactEvidence({
    sources: {
      website: { email: "first@conflict.example", email_reachable: true, suppressed: true },
      public_directory: { email: "second@conflict.example", email_reachable: true },
    },
  });
  const businessName = "Conflicted Business";
  const previewUrl = `https://preview.wss-ai.com/try/${slugFor(businessName)}/`;
  const prospect = {
    prospect_id: "lead-conflicted-1",
    business_name: businessName,
    email: "first@conflict.example", // <- raw email is present and truthy
    city: "Irvine",
    industry: "landscaping",
    report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
    preview_url: previewUrl,
    current_website: CURRENT_SITE,
    before_shot_source_url: BEFORE_SHOT_SOURCE,
    ...currentBuildProof({ businessName, previewUrl }),
    contact_enrichment: contactEnrichment,
    outreach_review_hold: contactEnrichment.outreach.review_hold,
    outreach_hold_reasons: contactEnrichment.outreach.hold_reasons,
  };
  const result = await sendSequenceStep({ prospect, sequence: 1, step: 1, dryRun: true });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "contact_confidence_review_hold");
  assert.ok(result.holdReasons.includes("email_suppressed"));
  assert.ok(result.holdReasons.includes("email_conflict_review_required"));
});

test("sendSequenceStep refuses a low-confidence directory-only address", async () => {
  baseEnv();
  const { sendSequenceStep } = require("../lib/email");
  const contactEnrichment = enrichContactEvidence({
    sources: { public_directory: { email: "listing@directory.example", email_reachable: true } },
  });
  const businessName = "Directory Only Business";
  const previewUrl = `https://preview.wss-ai.com/try/${slugFor(businessName)}/`;
  const prospect = {
    prospect_id: "lead-lowconf-1",
    business_name: businessName,
    email: "listing@directory.example",
    city: "Irvine",
    industry: "landscaping",
    report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
    preview_url: previewUrl,
    current_website: CURRENT_SITE,
    before_shot_source_url: BEFORE_SHOT_SOURCE,
    ...currentBuildProof({ businessName, previewUrl }),
    contact_enrichment: contactEnrichment,
    outreach_review_hold: contactEnrichment.outreach.review_hold,
    outreach_hold_reasons: contactEnrichment.outreach.hold_reasons,
  };
  // The gate sits before the dryRun early-return in lib/email.js (same as the
  // build-quality gate), so it applies identically whether or not this is a
  // real send — dryRun:true here only avoids needing a live suppression-check
  // store connection in this unit-test environment.
  const result = await sendSequenceStep({ prospect, sequence: 1, step: 1, dryRun: true });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, "contact_confidence_review_hold");
});

test("sendSequenceStep behaves exactly as before for a legacy prospect with no contact_enrichment at all", async () => {
  baseEnv();
  const { sendSequenceStep } = require("../lib/email");
  const businessName = "Legacy Business";
  const previewUrl = `https://preview.wss-ai.com/try/${slugFor(businessName)}/`;
  const result = await sendSequenceStep({
    prospect: {
      prospect_id: "legacy-lead-1",
      business_name: businessName,
      email: "owner@legacy-business.test",
      city: "Irvine",
      industry: "landscaping",
      report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
      preview_url: previewUrl,
      current_website: CURRENT_SITE,
      before_shot_source_url: BEFORE_SHOT_SOURCE,
      ...currentBuildProof({ businessName, previewUrl }),
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.blocked, undefined);
});

// ---- allowContactHoldBypass: the ONLY escape hatch on the contact-hold gate ----
//
// Prospect delivery may use this flag only under the established three-part
// owner envelope. A real internal owner proof is safer and simpler: it skips
// prospect contact state because the prospect is not the recipient, while the
// exact GHOST_AGENCY_OWNER_EMAIL gate remains mandatory.
//
// The prospect below is held for a HARD reason (email_suppressed). Both halves
// share one fixture on purpose: the security cases and the positive case differ
// only in the flags and the recipient, so the positive case cannot pass by way of
// a gate that was never armed. OWNER_EMAIL is asserted separately below.
const OWNER_EMAIL = "owner@wss-ai.test";

function heldProspectFields() {
  const contactEnrichment = enrichContactEvidence({
    sources: { website: { email: "first@conflict.example", email_reachable: true, suppressed: true } },
  });
  const businessName = "Conflicted Business";
  const previewUrl = `https://preview.wss-ai.com/try/${slugFor(businessName)}/`;
  return {
    business_name: businessName,
    city: "Irvine",
    industry: "landscaping",
    report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
    preview_url: previewUrl,
    current_website: CURRENT_SITE,
    before_shot_source_url: BEFORE_SHOT_SOURCE,
    ...currentBuildProof({ businessName, previewUrl }),
    contact_enrichment: contactEnrichment,
    outreach_review_hold: contactEnrichment.outreach.review_hold,
    outreach_hold_reasons: contactEnrichment.outreach.hold_reasons,
  };
}

test("SECURITY: prospect contact holds are skipped only by an owner-proof to the exact owner address", async () => {
  baseEnv();
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER_EMAIL;
  const { sendSequenceStep } = require("../lib/email");
  const sharedProspectFields = heldProspectFields();
  const attempt = (id, email, extra) => sendSequenceStep({
    prospect: { ...sharedProspectFields, prospect_id: id, email },
    sequence: 1,
    step: 1,
    dryRun: true,
    ...extra,
  });

  // (a) Owner-proof lane, bypass flag set, but NOT addressed to the owner ->
  //     refused. This is the case that would let an operator launder a held
  //     prospect address through the proof lane.
  const notOwner = await attempt("owner-proof-1a", "first@conflict.example", {
    allowContactHoldBypass: true,
    internalOwnerProof: true,
  });
  assert.equal(notOwner.ok, false, JSON.stringify(notOwner));
  assert.equal(notOwner.blocked, "owner_proof_recipient_gate_failed");

  // (b) NON-PROOF send, bypass flag set, addressed to the owner -> refused. The
  //     flag alone is not authority; it only counts inside the owner-proof lane.
  const notProof = await attempt("owner-proof-1c", OWNER_EMAIL, {
    allowContactHoldBypass: true,
    internalOwnerProof: false,
  });
  assert.equal(notProof.ok, false, JSON.stringify(notProof));
  assert.equal(notProof.blocked, "contact_confidence_review_hold");

  // (c) NON-PROOF send, bypass flag set, non-owner address -> refused. Neither
  //     condition present; the plain prospect-send path stays closed.
  const neither = await attempt("owner-proof-1d", "first@conflict.example", {
    allowContactHoldBypass: true,
    internalOwnerProof: false,
  });
  assert.equal(neither.ok, false, JSON.stringify(neither));
  assert.equal(neither.blocked, "contact_confidence_review_hold");

  // (d) Owner-proof lane to the owner's own address needs no prospect-contact
  //     bypass. The prospect is not the recipient, so their suppression and
  //     confidence state cannot block this owner-only envelope.
  const noFlag = await attempt("owner-proof-1e", OWNER_EMAIL, {
    internalOwnerProof: true,
  });
  assert.equal(noFlag.ok, true, JSON.stringify(noFlag));
  assert.equal(noFlag.ownerProof, true);
  assert.equal(noFlag.deliveryLane, "owner_only_proof");
});

test("SECURITY: owner proof refuses when no exact owner address is configured", async () => {
  baseEnv();
  delete process.env.GHOST_AGENCY_OWNER_EMAIL;
  const { sendSequenceStep } = require("../lib/email");
  // With no owner on file there is no address the bypass can be "to", so an
  // unset/blank GHOST_AGENCY_OWNER_EMAIL must not degrade into "any recipient".
  const result = await sendSequenceStep({
    prospect: { ...heldProspectFields(), prospect_id: "owner-proof-1f", email: OWNER_EMAIL },
    sequence: 1,
    step: 1,
    dryRun: true,
    allowContactHoldBypass: true,
    internalOwnerProof: true,
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "owner_proof_recipient_gate_failed");
});

test("POSITIVE: allowContactHoldBypass DOES bypass the gate for an internal owner-proof send to the owner's own address", async () => {
  baseEnv();
  process.env.GHOST_AGENCY_OWNER_EMAIL = OWNER_EMAIL;
  const { sendSequenceStep } = require("../lib/email");
  const toOwner = await sendSequenceStep({
    prospect: { ...heldProspectFields(), prospect_id: "owner-proof-1b", email: OWNER_EMAIL },
    sequence: 1,
    step: 1,
    dryRun: true,
    allowContactHoldBypass: true,
    internalOwnerProof: true,
  });
  assert.equal(toOwner.ok, true, JSON.stringify(toOwner));
  assert.equal(toOwner.blocked, undefined);
  // A positive control that only proves "no longer blocked by THIS gate" is not a
  // positive control — every later gate could still have refused and the bypass
  // would look identical. Assert the send actually reached full composition and
  // stayed in the owner-only lane, and that the proof-first before/after really
  // rendered rather than being waved through.
  assert.equal(toOwner.ownerProof, true);
  assert.equal(toOwner.deliveryLane, "owner_only_proof");
  assert.deepEqual(toOwner.cc, []);
  assert.deepEqual(toOwner.bcc, []);
  const html = String(toOwner.htmlPreview || "");
  // THE PANEL IS ASSERTED BY WHAT IT MUST CONTAIN, NOT BY ONE COMPOSER'S
  // CAPTION. The two proof composers label the same before/after panel
  // differently — outreachHtmlV2 captions it "Your site today", V3 captions the
  // two halves "Before" and "After ▸ open it live" — so pinning V2's wording
  // here made a caption string stand in for "the comparison rendered". The
  // structural assertions below (two signed shots, correct kinds, correct alt
  // text) are the actual positive control and are unchanged.
  assert.match(
    html,
    /Your site today|>\s*Before\s*<[\s\S]*?open it live/i,
    "the before/after comparison panel did not render",
  );
  // Read the rendered DOM, not the gate's verdict. Both proof panels must resolve
  // to real signed shot URLs on our own media endpoint — the "before" one being
  // empty is exactly the no_before_after_visuals failure this fixture exists to
  // clear, and it would be invisible in a status field.
  const proofShots = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]*preview-shot[^"]*)"[^>]*>/gi)];
  // 2 on the V2 shell; 3 on V3 since the 2026-08-12 compression pass, whose
  // how-to-get-in door reuses the AFTER shot as door 1's thumbnail. The
  // positive control below reads the FIRST TWO — the before/after pair — whose
  // kinds, order and alt text are identical on both shells.
  assert.equal(
    proofShots.length,
    proofEmailV3Enabled() ? 3 : 2,
    `expected the proof shots in the DOM, got ${proofShots.length}`,
  );
  assert.match(proofShots[0][1], /^https:\/\/ghost\.wss-ai\.com\/api\/media\/preview-shot\?/);
  // `&` is HTML-escaped to `&amp;` in the rendered attribute.
  assert.match(proofShots[0][1], /[?&](?:amp;)?k=old\./);
  assert.match(proofShots[0][1], /[?&](?:amp;)?v=old\b/);
  assert.match(proofShots[1][1], /[?&](?:amp;)?k=new\./);
  assert.match(proofShots[1][1], /[?&](?:amp;)?v=new\b/);
  // Same reasoning as the caption above: the alt text must name THIS business
  // and mark the shot as their existing site, which both composers do in their
  // own words ("… current site" / "… site before").
  assert.match(proofShots[0][0], /alt="Conflicted Business[^"]*(?:current site|site before)"/);
  assert.match(proofShots[1][0], /alt="Conflicted Business[^"]*(?:rebuilt site|new site)"/);
});
