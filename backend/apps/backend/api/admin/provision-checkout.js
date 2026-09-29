"use strict";

// api/admin/provision-checkout.js — OWNER ACTION: mark an invoiced customer
// as paid-out-of-band and provision their access.
//
// The honest /factory-os page sells the plan on invoice while Stripe keys
// are unset. When that invoice is settled, THIS is the one-click completion:
// it writes the same critical rows the Stripe webhook path writes (job
// status, entitlement, ghost_agency_dashboard_access) and sends the same
// welcome/activation email (magic link + PIN). See lib/fulfillment.js
// provisionInvoicedCheckout for exactly what is and is NOT done here.
//
// POST { job_id, customer_email, business_name?, desired_domain?, dry_run? }
// dry_run:true performs every DB write but skips the email send — use it to
// verify wiring without emailing anyone.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { provisionInvoicedCheckout } = require("../../lib/fulfillment");

const INPUT_ERRORS = new Set([
  "provision_job_id_missing",
  "provision_customer_email_invalid",
]);

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req);
    const provisioned = await provisionInvoicedCheckout({
      jobId: body.job_id || body.jobId,
      customerEmail: body.customer_email || body.customerEmail,
      businessName: body.business_name || body.businessName,
      desiredDomain: body.desired_domain || body.desiredDomain,
      dryRun: body.dry_run === true,
    });
    sendJson(res, 200, { ok: true, provisioned });
  } catch (error) {
    const code = String(error?.code || "");
    if (INPUT_ERRORS.has(code)) {
      sendJson(res, 400, { ok: false, error: code });
      return;
    }
    if (code === "dashboard_access_secret_missing") {
      sendJson(res, 503, {
        ok: false,
        error: code,
        hint: "Set CONNECT_APP_TOKEN (or GHOST_AGENCY_ADMIN_TOKEN) so dashboard credentials can be signed.",
      });
      return;
    }
    handleError(res, error);
  }
};
