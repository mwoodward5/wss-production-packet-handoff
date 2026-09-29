"use strict";

const { requireAdmin } = require("../../lib/admin-auth");
const { buildCanonicalJob } = require("../../lib/packets");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent, upsertRow } = require("../../lib/store");
const { validateRequired } = require("../../lib/validation");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  if (req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      route: "agents/orchestrate",
      method: "POST",
      purpose: "Seed an internal prospect/job into the Ghost Agency operating queue.",
    });
    return;
  }
  try {
    const body = await readJson(req);
    const job = buildCanonicalJob(body);
    const prospectContract = {
      prospect_id: job.prospect.id,
      business_name: job.prospect.businessName,
      city: job.prospect.city,
      state: job.prospect.state,
      source: job.prospect.source || "manual",
      created_at: job.createdAt,
    };
    const validation = validateRequired("prospect", prospectContract);
    if (!validation.ok) {
      sendJson(res, 400, { ok: false, error: "invalid_prospect_contract", validation });
      return;
    }

    const persisted = await upsertRow(
      "ghost_agency_prospects",
      {
        prospect_id: job.prospect.id,
        status: "new",
        business_name: job.prospect.businessName,
        owner_name: job.prospect.ownerName || null,
        email: job.prospect.ownerEmail || null,
        owner_email: job.prospect.ownerEmail || null,
        phone: job.prospect.phone || null,
        current_website: job.prospect.currentWebsite || null,
        industry: job.prospect.industry,
        city: job.prospect.city,
        state: job.prospect.state,
        primary_services: job.prospect.services || [],
        source: job.prospect.source,
        record: job.prospect,
        updated_at: new Date().toISOString(),
      },
      "prospect_id",
    );

    await recordEvent("prospect.intake", {
      jobId: job.id,
      prospectId: job.prospect.id,
      businessName: job.prospect.businessName,
      source: job.prospect.source,
    });

    sendJson(res, 200, {
      ok: true,
      mode: "orchestration_seeded",
      job,
      validation,
      persisted,
      next: [
        "cron/nightly-pipeline can now pick up the prospect row.",
        "checkout/webhook still controls paid delivery.",
        "VAPI/Twilio remain blocked unless explicit consent is present.",
      ],
    });
  } catch (error) {
    handleError(res, error);
  }
};
