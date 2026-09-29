"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { outreachFromStatus } = require("../../lib/env-compat");
const { outreachDnsStatus } = require("../../lib/outreach-dns");
const { providerStatus } = require("../../lib/registry");
const { reviewHoldActive } = require("../../lib/email");
const { deliveryPauseStatus } = require("../../lib/delivery-pause");
const { readinessVerdict } = require("../../lib/readiness-blockers");

// Every gate below contributes a machine `code` plus the human `reason` that has
// always been reported in hardStops. hardStops is derived from this list, so the
// set of things that block launch is unchanged - only the reporting is complete.
const BLOCKER_CODES = {
  outreachSender: "outreach_sender_unconfigured",
  outreachDns: "outreach_dns_records_missing",
  resendWebhook: "resend_webhook_secret_missing",
  unsubscribeSecret: "unsubscribe_secret_missing",
  postalWithoutUnsubscribe: "postal_address_without_unsubscribe",
  vapiCleanLane: "vapi_clean_lane_unconfigured",
  reviewHold: "review_hold_active",
  deliveryPause: "delivery_pause_active",
};

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const providers = providerStatus();
    const blockers = [];
    const notes = [];
    const outreachSender = outreachFromStatus();
    const [outreachDns, deliveryPause] = await Promise.all([
      outreachDnsStatus(),
      deliveryPauseStatus(),
    ]);
    const reviewHold = reviewHoldActive();

    if (!outreachSender.ok) {
      blockers.push({ code: BLOCKER_CODES.outreachSender, reason: outreachSender.reason });
    }
    if (!outreachDns.ok) {
      blockers.push({
        code: BLOCKER_CODES.outreachDns,
        reason: "go.wss-ai.com SPF/DKIM/DMARC DNS records missing at authoritative nameservers",
      });
    }
    if (!providers.resend.webhookConfigured) {
      blockers.push({ code: BLOCKER_CODES.resendWebhook, reason: "GHOST_AGENCY_RESEND_WEBHOOK_SECRET missing" });
    }
    if (!providers.resend.unsubscribeConfigured) {
      blockers.push({ code: BLOCKER_CODES.unsubscribeSecret, reason: "EMAIL_UNSUB_SECRET missing" });
    }
    if (providers.resend.postalAddressConfigured) {
      if (providers.resend.unsubscribeConfigured) {
        notes.push(
          "GHOST_AGENCY_POSTAL_ADDRESS is set and unsubscribe is configured; re-run /api/proof/unsubscribe-chain before each acquisition batch",
        );
      } else {
        blockers.push({
          code: BLOCKER_CODES.postalWithoutUnsubscribe,
          reason: "GHOST_AGENCY_POSTAL_ADDRESS is set but unsubscribe is NOT configured; acquisition email blocked",
        });
      }
    }
    if (!providers.vapi.cleanLaneConfigured) {
      blockers.push({
        code: BLOCKER_CODES.vapiCleanLane,
        reason: "VAPI_LOCAL_GROWTH_ASSISTANT_ID and VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID missing",
      });
    }
    // reviewHold and deliveryPause are owner approval gates. They already stopped
    // launch; before this they were reported only as detached top-level fields,
    // so a caller reading the blocker list saw a blocked verdict with nothing
    // behind it. They are first-class blockers now, and still owner-controlled.
    if (reviewHold) {
      blockers.push({ code: BLOCKER_CODES.reviewHold, reason: "Cold outreach review hold is active" });
    }
    if (deliveryPause.active) {
      blockers.push({
        code: BLOCKER_CODES.deliveryPause,
        reason: `Cold outreach delivery pause is active: ${deliveryPause.reason || "threshold crossed"}`,
        detail: { reasonCode: deliveryPause.reason || "threshold_crossed", known: deliveryPause.known === true },
      });
    }

    const verdict = readinessVerdict({ blockers });

    sendJson(res, 200, {
      ok: true,
      providers,
      outreachSender,
      outreachDns,
      reviewHold,
      deliveryPause,
      blockers: verdict.blockers,
      // Retained verbatim for existing consoles/probes that read hardStops.
      hardStops: verdict.blockers.map((blocker) => blocker.reason),
      notes,
      ready: verdict.ready,
    });
  } catch (error) {
    handleError(res, error);
  }
};
