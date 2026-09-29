"use strict";
// api/riley-phone.js — PUBLIC resolver for the real "Riley" voice-agent phone
// number. A phone number meant to be dialed isn't sensitive, so unlike
// admin/agent-phone.js this has no auth gate. Prefers GHOST_AGENCY_AGENT_PHONE;
// falls back to resolving the live Vapi phone-number id via the Vapi API so
// the number shown to prospects is always the real, currently-active line —
// never a hardcoded/fabricated one.
const { handleError, methodGuard, sendJson } = require("../lib/http");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  res.setHeader("Cache-Control", "public, max-age=300");
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
        error: "No Riley phone line configured yet.",
        missing: [!apiKey ? "VAPI_API_KEY" : null, !phoneId ? "VAPI_*_PHONE_NUMBER_ID" : null].filter(Boolean),
      });
    }
    const response = await fetch(`https://api.vapi.ai/phone-number/${encodeURIComponent(phoneId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return sendJson(res, 200, { ok: false, error: `Vapi phone-number lookup failed (HTTP ${response.status}).` });
    }
    const phone = data.number || data.phoneNumber || data.e164 || "";
    return sendJson(res, 200, { ok: Boolean(phone), source: "vapi:clean-lane", phone });
  } catch (error) {
    handleError(res, error);
  }
};
