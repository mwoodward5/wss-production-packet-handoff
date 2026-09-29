"use strict";

// Owner-only email smoke (admin-gated). The email analog of the VAPI owner smoke.
// Sends ONE real templated email — rendered by the production template code —
// to GHOST_AGENCY_OWNER_EMAIL and NO ONE ELSE. Hard-refuses any other recipient.
//
// This is NOT acquisition email: it is a transactional self-test to the owner's
// own inbox, so it is deliberately exempt from the postal-address acquisition gate.
// It still exercises the real Resend path, the real template render, and the real
// signed unsubscribe link (proving that link works end-to-end in a delivered email).
// It can never be used to reach a prospect.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { sendResendEmail, sendSequenceStep } = require("../../lib/email");
const { render } = require("../../lib/email-templates");
const { unsubscribeUrl } = require("../../lib/unsubscribe");
const { recordEvent } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const owner = process.env.GHOST_AGENCY_OWNER_EMAIL?.trim();
    if (!owner) {
      sendJson(res, 503, { ok: false, error: "owner_email_unset", message: "GHOST_AGENCY_OWNER_EMAIL is not set." });
      return;
    }

    // Render the real preview email (sequence 1, step 2) with sample owner-facing
    // vars and a real, live preview URL so the delivered email is representative.
    const previewUrl = "https://wss-ca-landscape-barriga-landscaping.vercel.app";
    // Keep every destination on the verified go.wss-ai.com sending domain.
    // The old Vercel alias caused Gmail's phishing guard to strip the CTA links
    // from the owner proof even though the rendered template itself was valid.
    const reportUrl = "https://go.wss-ai.com/report";
    const rendered = render(1, 2, {
      business_name: "Barriga Landscaping",
      owner_or_team: "there",
      industry: "landscaping",
      city: "Anaheim",
      primary_service: "landscaping",
      sender_name: process.env.GHOST_AGENCY_SENDER_NAME || "Mark",
      preview_url: previewUrl,
      report_url: reportUrl,
    });

    // Owner-only: prove the signed unsubscribe link renders in a real delivered email.
    const unsub = unsubscribeUrl({ email: owner, prospectId: "owner-email-smoke" });

    const banner =
      "[OWNER SMOKE TEST — this is a system self-test sent only to the owner address. " +
      "It is NOT a prospect/acquisition email. The CAN-SPAM postal footer is added only " +
      "on real acquisition sends once GHOST_AGENCY_POSTAL_ADDRESS is set.]\n\n";
    const text =
      banner +
      rendered.body +
      `\n\n--\nWSS Labs (owner smoke)\n` +
      `Unsubscribe (real signed link, proves the opt-out path): ${unsub}\n`;

    // Compose through the REAL outreach pipeline (dry run) so the owner sees the
    // exact branded HTML a prospect receives: hero thumbnail, labeled links,
    // signed /api/report link, compliance footer.
    const composed = await sendSequenceStep({
      prospect: {
        prospect_id: "owner-email-smoke",
        business_name: "Barriga Landscaping",
        industry: "landscaping",
        city: "Anaheim",
        email: owner,
        preview_url: previewUrl,
        record: { rating: 4.9, review_count: 12, weaknesses: ["No website listed on Google profile", "Low review count"] },
      },
      sequence: 1,
      step: 1,
      dryRun: true,
      allowBuildQualityBypass: true,
    });
    const result = await sendResendEmail({
      // This proof must exercise the same verified sender and Resend tracking
      // configuration as real outreach.  The transactional fallback is still
      // permitted for operational mail, but is not an honest outreach proof.
      senderKind: "outreach",
      to: owner,
      subject: `[SMOKE] ${rendered.subject}`,
      text,
      html: composed.htmlPreview || `<pre style="white-space:pre-wrap;font:15px/1.55 system-ui,sans-serif">${text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</pre>`,
    });

    await recordEvent("proof.owner_email_smoke", {
      to: `${owner.slice(0, 3)}***`,
      mode: result.mode,
      resendId: result.id,
    });

    sendJson(res, result.mode === "sent" ? 200 : 502, {
      ok: result.mode === "sent",
      mode: result.mode,
      sentTo: `${owner.slice(0, 3)}***`,
      resendId: result.id || null,
      renderedSubject: rendered.subject,
      previewUrl,
      unsubscribeLinkIncluded: Boolean(unsub),
      note: "Owner-only self-test. No prospect was emailed. Postal gate still governs all acquisition sends.",
      error: result.error,
    });
  } catch (error) {
    handleError(res, error);
  }
};
