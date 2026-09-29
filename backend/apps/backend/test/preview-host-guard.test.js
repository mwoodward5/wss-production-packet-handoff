"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isApprovedPreviewUrl,
  previewHostRejection,
  sanitizePreviewUrl,
} = require("../lib/preview-host-guard");

// Regression lock for the 2026-07-23 incident: a "Signature Landscape" outreach
// email shipped with a preview_url on the retired siteforge-app-rocketsites
// .vercel.app host, which was still serving an unrelated donor site (Howie
// Excavating & Grading). The preview guard still protects post-consent build
// surfaces; pre-consent outreach now ignores every persisted preview artifact.

test("approves real build hosts: any https subdomain of wss-ai.com", () => {
  assert.equal(isApprovedPreviewUrl("https://urban-nail-bar.wss-ai.com/"), true);
  assert.equal(isApprovedPreviewUrl("https://ab-professional-detailing.wss-ai.com/"), true);
  assert.equal(isApprovedPreviewUrl("https://all-season-pros-hvac.wss-ai.com/try/x/"), true);
  assert.equal(isApprovedPreviewUrl("https://wss-ai.com/"), true, "apex is acceptable");
  assert.equal(isApprovedPreviewUrl("https://URBAN.WSS-AI.COM/"), true, "host match is case-insensitive");
  assert.equal(
    isApprovedPreviewUrl("https://urban.wss-ai.com./"),
    true,
    "a trailing DNS root dot is the same host",
  );
});

test("rejects the retired rocketsites host that caused the incident", () => {
  const dead = "https://siteforge-app-rocketsites.vercel.app/";
  assert.equal(isApprovedPreviewUrl(dead), false);
  assert.match(previewHostRejection(dead), /RETIRED/);
  assert.equal(
    isApprovedPreviewUrl("https://siteforge-app-rocketsites.vercel.app/ghost-preview/abc123/"),
    false,
    "a path does not launder a dead host",
  );
});

test("allows the LIVE first-party SiteForge build host", () => {
  // The full-run lane publishes previews as siteforge-app-seven.vercel.app/try/<slug>/.
  // Refusing every *.vercel.app host blocked real, working builds — only the
  // RETIRED rocketsites deployment must never ship.
  // RETIRED 2026-07-29: /try/ is the old V5 surface (served the APOC logo on a
  // customer preview). Prospect previews are wss-ai.com mirrors only.
  assert.equal(isApprovedPreviewUrl("https://siteforge-app-seven.vercel.app/try/hb-landscape-design-llc/"), false);
  // ...but the allowance is one exact host, never a wildcard over .vercel.app.
  assert.equal(isApprovedPreviewUrl("https://siteforge-app-eight.vercel.app/"), false);
});

test("rejects every other non-wss-ai.com host, including sibling vercel deployments", () => {
  for (const url of [
    "https://ghost-agency-backend.vercel.app/",
    "https://example.com/",
    "https://allseasonprosllc.godaddysites.com/",
  ]) {
    assert.equal(isApprovedPreviewUrl(url), false, `${url} must not pass`);
  }
});

test("rejects near-miss spoofs of the canonical domain", () => {
  // The classic suffix-vs-substring mistakes. Each of these CONTAINS the string
  // "wss-ai.com" but is a different registrable host.
  for (const url of [
    "https://wss-ai.com.evil.com/",
    "https://evil-wss-ai.com/",
    "https://notwss-ai.com/",
    "https://wss-ai.com.attacker.net/preview/",
    "https://wss-ai.com@evil.com/", // userinfo trick: real hostname is evil.com
  ]) {
    assert.equal(isApprovedPreviewUrl(url), false, `${url} must not pass`);
  }
});

test("fails closed on http, empty, and unparseable input", () => {
  assert.equal(isApprovedPreviewUrl("http://urban-nail-bar.wss-ai.com/"), false, "https required");
  assert.equal(isApprovedPreviewUrl(""), false);
  assert.equal(isApprovedPreviewUrl("   "), false);
  assert.equal(isApprovedPreviewUrl(null), false);
  assert.equal(isApprovedPreviewUrl(undefined), false);
  assert.equal(isApprovedPreviewUrl("not a url"), false);
  assert.equal(isApprovedPreviewUrl("urban-nail-bar.wss-ai.com"), false, "scheme required");
});

test("sanitizePreviewUrl keeps approved URLs and drops everything else", () => {
  assert.equal(
    sanitizePreviewUrl("https://urban-nail-bar.wss-ai.com/"),
    "https://urban-nail-bar.wss-ai.com/",
  );
  // This is what stops a stale URL being carried forward onto a prospect record
  // by a non-ready rebuild and re-emailed later.
  assert.equal(sanitizePreviewUrl("https://siteforge-app-rocketsites.vercel.app/"), "");
  assert.equal(sanitizePreviewUrl(""), "");
});

// MIGRATED 2026-07-31: IGNORE -> HARD REFUSE (a strengthening, not a relaxation).
//
// This test used to assert that a persisted preview_url on the retired
// rocketsites host was silently dropped from the body and the email went out
// anyway. That was survivable under consent-first, where the preview was
// decoration and the copy claimed nothing had been built.
//
// Proof-first makes the preview link the entire proposition, so "the host is
// dead / not ours, carry on and mail them anyway" is no longer a coherent
// outcome — and the 2026-07-23 incident this file exists for was precisely a
// prospect being mailed a link to a host that served ANOTHER BUSINESS'S site.
// lib/email.js now applies isApprovedPreviewUrl() before it composes anything.
//
// The property the old assertion protected — the dead host never reaches a
// prospect's inbox — is now guaranteed by construction: there is no body at all.
test("proof-first outreach hard-refuses a persisted preview_url on a retired host", async () => {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const { sendSequenceStep } = require("../lib/email");
  // Exactly the shape of the real incident: the prospect is Signature Landscape
  // but the persisted preview points at the dead host serving another business.
  const result = await sendSequenceStep({
    prospect: {
      prospect_id: "lead-retired-host",
      business_name: "Signature Landscape",
      email: "owner@example.test",
      city: "Irvine",
      industry: "landscaping",
      current_website: "https://signature-landscape.example/",
      before_shot_source_url: "https://www.signature-landscape.example/",
      report_url: "https://callprep.wss-ai.com/report/audit/ready?artifact=scorecard.json",
      preview_url: "https://siteforge-app-rocketsites.vercel.app/",
      siteforge_renderer: "05-build-v8",
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.blocked, "preview_host_not_approved");
  assert.match(result.detail.reason, /RETIRED/);
  // Nothing was composed, so the dead host cannot leak into an email at all.
  assert.equal(result.htmlPreview, undefined);
  assert.equal(result.bodyPreview, undefined);
  assert.equal(result.subject, undefined);
});
