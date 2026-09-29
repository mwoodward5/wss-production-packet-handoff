"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { canBypassDeliveryPause, canBypassReviewHold } = require("../lib/email");
const { canonicalStage, reconcileTracking, reconcileTrackingTruth } = require("../lib/tracking-truth");

test("tracking events use one canonical vocabulary", () => {
  assert.equal(canonicalStage("resend.webhook", { type: "email.delivered" }), "delivered");
  assert.equal(canonicalStage("email.clicked"), "clicked");
  assert.equal(canonicalStage("outreach.unsubscribe"), "unsubscribed");
});

test("reconciliation counts unique message evidence, not duplicate webhook deliveries", () => {
  const result = reconcileTracking({
    emailLogs: [{ mode: "sent", payload: { resendId: "m1" } }, { mode: "sent", payload: { resendId: "m2" } }],
    events: [
      { type: "resend.webhook", payload: { type: "email.delivered", email_id: "m1" } },
      { type: "resend.webhook", payload: { type: "email.delivered", email_id: "m1" } },
      { type: "resend.webhook", payload: { type: "email.opened", email_id: "m1" } },
      { type: "resend.webhook", payload: { type: "email.clicked", email_id: "m1" } },
      { type: "outreach.unsubscribed", payload: { email_id: "m2" } },
    ],
    env: { GHOST_AGENCY_RESEND_WEBHOOK_SECRET: "configured", GHOST_AGENCY_OUTREACH_FROM: "WSS <hi@go.wss-ai.com>", GHOST_AGENCY_API_URL: "https://api.example", GHOST_AGENCY_TRACKING_PIXEL_ENABLED: "true", RESEND_CLICK_TRACKING_ENABLED: "true" },
  });
  assert.deepEqual(result.counts, { sent: 2, accepted: 0, delivered: 1, opened: 1, clicked: 1, bounced: 0, complained: 0, unsubscribed: 1 });
  assert.equal(result.zeroOpenMeaning, "observed");
});

test("zero opens are called untracked when webhook configuration is absent", () => {
  const result = reconcileTracking({ emailLogs: [{ mode: "sent", payload: { resendId: "m1" } }], env: {} });
  assert.equal(result.counts.opened, 0);
  assert.equal(result.zeroOpenMeaning, "untracked");
  assert.ok(result.warnings.includes("resend_webhook_unconfigured"));
});

test("tracking truth reconciles webhook email_id to email log resendId and deduplicates provider events", () => {
  const truth = reconcileTrackingTruth({
    emails: [
      { prospect_id: "lead-a", mode: "sent", suppressed: false, payload: { resendId: "re_a", runId: "run-1" } },
      { prospect_id: "lead-b", mode: "sent", suppressed: false, payload: { resendId: "re_b" } },
      { prospect_id: "lead-c", mode: "dry_run", suppressed: false, payload: { resendId: "re_c" } },
    ],
    events: [
      { type: "resend.webhook", payload: { type: "email.delivered", email_id: "re_a" } },
      { type: "resend.webhook", payload: { type: "email.opened", email_id: "re_a" } },
      { type: "resend.webhook", payload: { type: "email.opened", email_id: "re_a" } },
      { type: "resend.webhook", payload: { type: "email.clicked", email_id: "re_a" } },
      { type: "resend.webhook", payload: { type: "email.bounced", email_id: "re_b" } },
      { type: "resend.webhook", payload: { type: "email.delivered", email_id: "unlogged" } },
      { type: "resend.webhook", payload: { event: "email.delivered", data: { email_id: "re_b" } } },
    ],
  });

  assert.deepEqual(truth.counts, { sent: 2, delivered: 2, opened: 1, clicked: 1, bounced: 1 });
  assert.deepEqual([...truth.prospectMetrics.get("lead-a")].sort(), ["clicked", "delivered", "opened", "sent"]);
  assert.match(truth.definitions.opened, /privacy controls can undercount/);
});

test("delivery pause bypass requires the configured owner recipient and internal proof flag", () => {
  const previous = process.env.GHOST_AGENCY_OWNER_EMAIL;
  process.env.GHOST_AGENCY_OWNER_EMAIL = "owner@example.com";
  try {
    assert.equal(canBypassDeliveryPause({ to: "owner@example.com", allowDeliveryPauseBypass: true, internalOwnerProof: true }), true);
    assert.equal(canBypassDeliveryPause({ to: "other@example.com", allowDeliveryPauseBypass: true, internalOwnerProof: true }), false);
    assert.equal(canBypassDeliveryPause({ to: "owner@example.com", allowDeliveryPauseBypass: true, internalOwnerProof: false }), false);
    assert.equal(canBypassReviewHold({ to: "owner@example.com", allowReviewHoldBypass: true, internalOwnerProof: true }), true);
    assert.equal(canBypassReviewHold({ to: "other@example.com", allowReviewHoldBypass: true, internalOwnerProof: true }), false);
    assert.equal(canBypassReviewHold({ to: "owner@example.com", allowReviewHoldBypass: true, internalOwnerProof: false }), false);
  } finally {
    if (previous === undefined) delete process.env.GHOST_AGENCY_OWNER_EMAIL;
    else process.env.GHOST_AGENCY_OWNER_EMAIL = previous;
  }
});

test("outreach templates retain the WSS Labs brand lock without weakening hold bypasses", () => {
  const emailSource = fs.readFileSync(require.resolve("../lib/email"), "utf8");
  const templateSource = fs.readFileSync(require.resolve("../lib/email-templates"), "utf8");
  assert.doesNotMatch(emailSource, /wsl-logo-horizontal\.png/);
  assert.doesNotMatch(templateSource, /Woodward Software Labs/);
  // Official mark from the wss-ai.com brand pack + the WSS LABS wordmark text.
  assert.match(emailSource, /wss-ai\.com\/assets\/apple-touch-icon\.png/);
  assert.match(emailSource, /WSS <span style="font-weight:700;color:#7FA0FF">LABS<\/span>/);
  assert.match(emailSource, /function canBypassReviewHold/);
  assert.match(emailSource, /internalOwnerProof/);
});
