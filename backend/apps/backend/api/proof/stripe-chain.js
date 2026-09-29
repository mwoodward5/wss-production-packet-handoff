"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { createCheckoutSession } = require("../../lib/stripe");
const { handleError, methodGuard, publicRequestUrl, readJson, sendJson } = require("../../lib/http");
const { providerStatus } = require("../../lib/registry");
const { recordEvent } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const url = new URL(publicRequestUrl(req));
    const mode = req.method === "POST" ? "create_checkout" : url.searchParams.get("mode") || "readiness";
    const providers = providerStatus();
    const readiness = {
      stripeConfigured: providers.stripe.configured,
      webhookConfigured: providers.stripe.webhookConfigured,
      supabaseLiveWrite: providers.supabase.mode === "live_write",
      resendConfigured: providers.resend.configured,
      woodwardLabsBuildTicketConfigured: providers.woodwardLabsBuildTicket.configured,
    };
    // Separate from the readiness gate above (which is an AND-of-required-
    // trues): these are config STATE, not requirements, so a false value
    // here must not flip `ok` false. Surfaced so a definitive true/false is
    // always one authenticated GET away, without ever needing a raw env
    // pull -- see the 2026-07-22 Stripe customer-activation-chain audit,
    // which flagged both of these as "unconfirmed" due to Vercel CLI
    // sensitive-var masking.
    const flags = {
      liveKeyDetected: providers.stripe.liveKeyDetected,
      liveKeyAllowed: providers.stripe.liveKeyAllowed,
      domainPurchaseLive: providers.stripe.domainPurchaseLive,
      testCheckoutEnabled: providers.stripe.testCheckoutEnabled,
      webhookSecretLooksValid: providers.stripe.webhookSecretLooksValid,
    };

    if (mode !== "create_checkout") {
      const ok = Object.values(readiness).every(Boolean);
      await recordEvent("proof.stripe_chain", { ok, mode: "readiness", readiness, flags });
      sendJson(res, ok ? 200 : 503, {
        ok,
        mode: "readiness",
        readiness,
        flags,
        note: "No checkout session was created. POST to this route with admin auth to create a test checkout link.",
      });
      return;
    }

    // HARD SAFETY GUARD: proof checkouts are test-mode only. Refuse live keys.
    const stripeKey = process.env.STRIPE_SECRET_KEY || "";
    if (!stripeKey.startsWith("sk_test_")) {
      await recordEvent("proof.stripe_chain", {
        ok: false,
        mode: "refused_live_key",
        note: "Proof checkout refused: STRIPE_SECRET_KEY is not a test-mode key.",
      });
      sendJson(res, 409, {
        ok: false,
        error: "live_key_refused",
        message:
          "Proof checkouts are test-mode only and STRIPE_SECRET_KEY is a live key. " +
          "Set a sk_test_ key (or a dedicated preview env) to run Stripe proofs. " +
          "Customer checkout via /api/checkout is unaffected.",
        readiness,
      });
      return;
    }

    const body = await readJson(req);
    const checkout = await createCheckoutSession({
      prospect: {
        businessName: body.businessName || "Internal Stripe Proof Buyer",
        ownerEmail: body.ownerEmail || process.env.GHOST_AGENCY_OWNER_EMAIL || "",
        city: body.city || "Internal",
        state: body.state || "CA",
        industry: body.industry || "",
        source: "internal_test",
      },
    }, { ownerSandboxAuthorized: true });
    await recordEvent("proof.stripe_chain", { ok: checkout.mode === "checkout_session", mode: checkout.mode, jobId: checkout.jobId });
    sendJson(res, checkout.mode === "checkout_failed" ? 502 : 200, {
      ok: checkout.mode !== "checkout_failed",
      checkout,
      next: checkout.ownerSandboxCheckout
        ? "Open checkout.url and complete the $0 owner sandbox. It must not ask for Link or payment credentials."
        : "Use Stripe test card 4242 in checkout, then verify webhook entitlement and delivery queue.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
