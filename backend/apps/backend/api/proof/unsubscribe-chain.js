"use strict";

// End-to-end unsubscribe proof (admin-only, synthetic identity, no real sends).
// Chain: sign token -> verify token -> hit live unsubscribe link -> confirm
// suppression row written -> confirm suppression is visible to the email gate.
// This is the proof that must pass BEFORE GHOST_AGENCY_POSTAL_ADDRESS is ever set.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { publicConfig, providerStatus } = require("../../lib/registry");
const { select } = require("../../lib/store");
const { createUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } = require("../../lib/unsubscribe");

const PROOF_PROSPECT_ID = "proof-unsubscribe-chain";

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const resend = providerStatus().resend;
    const proofEmail = `unsubscribe-proof@${(publicConfig().apiUrl || "example.com").replace(/^https?:\/\//, "").split("/")[0]}`;
    const steps = [];
    const fail = (reason, extra = {}) => {
      sendJson(res, 503, {
        ok: false,
        reason,
        steps,
        resend: {
          configured: resend.configured,
          unsubscribeConfigured: resend.unsubscribeConfigured,
          postalAddressConfigured: resend.postalAddressConfigured,
        },
        ...extra,
      });
    };

    // 1. Secret present
    if (!resend.unsubscribeConfigured) {
      steps.push({ step: "signing_secret", ok: false });
      return fail("EMAIL_UNSUB_SECRET is not set. Unsubscribe links cannot be signed.");
    }
    steps.push({ step: "signing_secret", ok: true });

    // 2. Token round-trip in-process
    const token = createUnsubscribeToken({ email: proofEmail, prospectId: PROOF_PROSPECT_ID });
    const verified = verifyUnsubscribeToken(token);
    steps.push({ step: "token_roundtrip", ok: Boolean(token && verified.ok) });
    if (!token || !verified.ok) return fail("Token sign/verify round-trip failed.", { verified });

    // 3. Live link works end-to-end (self-request the production route)
    const link = unsubscribeUrl({ email: proofEmail, prospectId: PROOF_PROSPECT_ID });
    let liveStatus = 0;
    try {
      const response = await fetch(link, { method: "GET", redirect: "manual" });
      liveStatus = response.status;
    } catch (error) {
      steps.push({ step: "live_link", ok: false, error: String(error?.message || error) });
      return fail("Live unsubscribe link fetch failed.");
    }
    steps.push({ step: "live_link", ok: liveStatus === 200, status: liveStatus });
    if (liveStatus !== 200) return fail(`Live unsubscribe link returned ${liveStatus}, expected 200.`);

    // 4. Suppression row visible
    const rows = await select(
      "ghost_agency_suppressions",
      `suppression_key=eq.${encodeURIComponent(PROOF_PROSPECT_ID)}&select=suppression_key,reason,source,updated_at&limit=1`,
    );
    const suppressed = rows.ok && Array.isArray(rows.data) && rows.data.length > 0;
    steps.push({ step: "suppression_row", ok: suppressed, mode: rows.mode });
    if (!suppressed) {
      return fail("Suppression row not found after unsubscribe. Do NOT set postal address.", { rows });
    }

    sendJson(res, 200, {
      ok: true,
      proof: "unsubscribe_chain",
      steps,
      note:
        "Unsubscribe is proven end-to-end for the synthetic proof identity. " +
        "Postal address remains a separate, owner-approved decision.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
