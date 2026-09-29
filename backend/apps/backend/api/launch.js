"use strict";

// api/launch.js — DURABLE per-prospect checkout link.
//
// Why this exists: raw Stripe Checkout Session URLs expire after 24h, which is
// exactly how the AB Professional Detailing email CTA died ("Something went
// wrong"). And the HMAC-signed /api/checkout-link requires a shared secret that
// only lives in the deployed env. This endpoint instead verifies a per-prospect
// launch key stored on the prospect's own DB row (record.launch_key), so links
// can be minted by anything that can write to Supabase — no shared env secret.
//
// GET /api/launch?p=<prospect_id>&k=<launch_key>
//   -> verifies key against the prospect row (timing-safe)
//   -> creates a FRESH Stripe Checkout Session on every click
//   -> uses the single server-configured Local Growth price
//   -> 302 to Stripe
//
// A link is valid as long as the prospect row keeps that launch_key — rotate or
// clear the key to kill the link. Stripe mode (test vs live) is whatever the
// deployed STRIPE_SECRET_KEY is; this endpoint adds no live-mode capability.

const { timingSafeEqual } = require("node:crypto");
const { select } = require("../lib/store");
const { createCheckoutSession } = require("../lib/stripe");

function safeEqual(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  return A.length === B.length && A.length > 0 && timingSafeEqual(A, B);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    return res.end("Method not allowed");
  }
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  // FAIL CLOSED on live-mode Stripe. Standing rule: test mode only. The deployed
  // env was found carrying a live key on 2026-07-18 — until that is rotated to a
  // test key (or STRIPE_ALLOW_LIVE is deliberately set), refuse to mint sessions.
  if (
    String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live") &&
    String(process.env.STRIPE_ALLOW_LIVE || "").toLowerCase() !== "true"
  ) {
    res.statusCode = 503;
    return res.end("Checkout is in maintenance. Please reply to the email and the launch team will help.");
  }
  try {
    const prospectId = String(req.query?.p || "").trim().slice(0, 160);
    const key = String(req.query?.k || "").trim().slice(0, 200);
    if (!prospectId || !key) {
      res.statusCode = 400;
      return res.end("Missing launch parameters. Please reply to the email for a fresh link.");
    }
    const found = await select(
      "ghost_agency_prospects",
      `prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`
    );
    const prospect = found && found.ok && Array.isArray(found.data) ? found.data[0] : null;
    const record = (prospect && prospect.record) || {};
    if (!prospect || !safeEqual(record.launch_key, key)) {
      res.statusCode = 401;
      return res.end("This secure launch link is not valid. Please reply to the email and we'll send a fresh one.");
    }
    if (record.launch_key_expires && Date.parse(record.launch_key_expires) < Date.now()) {
      res.statusCode = 410;
      return res.end("This launch link has expired. Please reply to the email for a fresh one.");
    }

    const checkout = await createCheckoutSession({
      desiredDomain: record.desired_domain || "",
      previewProjectName: record.preview_project_name || "",
      job: {
        id: record.launch_job_id || `launch_${prospectId}`,
        product: "Local Growth Website Plan",
        owner: "Woodward Software",
        prospect: {
          id: prospectId,
          businessName: prospect.business_name || "Local Business",
          industry: record.vertical || "local service",
          city: prospect.city || "",
          state: prospect.state || "",
          ownerEmail: "",
        },
      },
    });

    if (checkout && checkout.mode === "checkout_session" && checkout.url) {
      res.statusCode = 302;
      res.setHeader("Location", checkout.url);
      return res.end();
    }
    res.statusCode = 503;
    return res.end("Checkout is temporarily unavailable. Please reply to the email and the launch team will help.");
  } catch {
    res.statusCode = 500;
    return res.end("We could not open checkout. Please reply to the email and the launch team will help.");
  }
};
