"use strict";

// Resolve the agency's public agent line. Prefers GHOST_AGENCY_AGENT_PHONE env;
// falls back to resolving the clean-lane VAPI phone-number id via the VAPI API.
// Admin-only: this exists so operators (and ops automation) can confirm the
// dialable number without reading provider dashboards.
const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const envPhone = String(process.env.GHOST_AGENCY_AGENT_PHONE || "").trim();
    if (envPhone) {
      return sendJson(res, 200, { ok: true, source: "env:GHOST_AGENCY_AGENT_PHONE", phone: envPhone });
    }
    const apiKey = String(process.env.VAPI_API_KEY || "").trim();
    const phoneId = String(
      process.env.VAPI_LOCAL_GROWTH_PHONE_NUMBER_ID || process.env.VAPI_PHONE_NUMBER_ID || "",
    ).trim();
    if (!apiKey || !phoneId) {
      return sendJson(res, 200, {
        ok: false,
        error: "GHOST_AGENCY_AGENT_PHONE is unset and VAPI is not configured to resolve one.",
        missing: [!apiKey ? "VAPI_API_KEY" : null, !phoneId ? "VAPI_*_PHONE_NUMBER_ID" : null].filter(Boolean),
      });
    }
    const response = await fetch(`https://api.vapi.ai/phone-number/${encodeURIComponent(phoneId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return sendJson(res, 200, { ok: false, error: `VAPI phone-number lookup failed (HTTP ${response.status}).` });
    }
    const phone = data.number || data.phoneNumber || data.e164 || "";
    return sendJson(res, 200, {
      ok: Boolean(phone),
      source: "vapi:clean-lane",
      phone,
      name: data.name || null,
      provider: data.provider || null,
      note: "Set GHOST_AGENCY_AGENT_PHONE to pin this value for email + site rendering.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
