"use strict";

const { handleError, methodGuard, sendJson } = require("../lib/http");
const { requireAdmin } = require("../lib/admin-auth");
const { select } = require("../lib/store");

function numericLimit(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(Math.max(parsed, 1), 100);
}

function publicHotLead(row = {}) {
  const consentToCall = Boolean(row.consent_to_call);
  const hasPhone = Boolean(row.phone);
  return {
    id: row.id,
    report_id: row.report_id,
    prospect_id: row.prospect_id,
    business: row.business || row.business_name || "",
    owner_name: row.owner_name || "",
    owner_email: row.owner_email || row.email || "",
    phone: row.phone || "",
    report_url: row.report_url || "",
    source: row.source || "",
    status: row.status || (consentToCall && hasPhone ? "hot_lead_consent_ready" : "hot_lead_consent_blocked"),
    opened_count: Number(row.opened_count || 0),
    last_opened_at: row.last_opened_at || row.updated_at || row.created_at,
    consent: {
      to_call: consentToCall,
      to_text: Boolean(row.consent_to_text),
      source: row.consent_source || "",
    },
    call_now_enabled: Boolean(row.call_now_enabled && consentToCall && hasPhone),
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  // hot_leads rows carry owner PII (owner_email, phone, owner_name) pulled via a
  // service-role query that bypasses RLS — this endpoint must be admin-only.
  if (!requireAdmin(req, res)) return;
  try {
    const base = `https://${req.headers.host || "localhost"}`;
    const url = new URL(req.url || "/api/hot-leads", base);
    const limit = numericLimit(url.searchParams.get("limit"));
    const result = await select(
      "hot_leads",
      `select=*&order=last_opened_at.desc&limit=${limit}`,
    );

    if (!result.ok) {
      sendJson(res, result.mode === "dry_run" ? 200 : 502, {
        ok: result.mode === "dry_run",
        mode: result.mode,
        leads: [],
        error: result.error,
        status: result.status,
      });
      return;
    }

    const leads = Array.isArray(result.data) ? result.data.map(publicHotLead) : [];
    sendJson(res, 200, {
      ok: true,
      mode: result.mode,
      count: leads.length,
      leads,
    });
  } catch (error) {
    handleError(res, error);
  }
};
