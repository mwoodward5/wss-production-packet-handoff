"use strict";

const { upsertRow } = require("./store");

function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function normalizedPhone(value) {
  const raw = cleanString(value, 80);
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  return raw.startsWith("+") ? `+${digits}` : digits;
}

function normalizedEmail(value) {
  return cleanString(value, 240).toLowerCase();
}

function consentKey(input) {
  if (input.phone) return `phone:${input.phone}`;
  if (input.email) return `email:${input.email}`;
  if (input.prospectId) return `prospect:${input.prospectId}`;
  if (input.reportId) return `report:${input.reportId}`;
  return "";
}

function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function patchHotLeads(identity, patch) {
  if (!supabaseConfigured()) {
    return { mode: "dry_run", configured: false, table: "hot_leads", patch };
  }

  const base = process.env.SUPABASE_URL.replace(/\/+$/, "");
  const url = new URL(`${base}/rest/v1/hot_leads`);
  if (identity.reportId) {
    url.searchParams.set("report_id", `eq.${identity.reportId}`);
  } else if (identity.phone) {
    url.searchParams.set("phone", `eq.${identity.phone}`);
  } else if (identity.email) {
    url.searchParams.set("email", `eq.${identity.email}`);
  } else if (identity.prospectId) {
    url.searchParams.set("prospect_id", `eq.${identity.prospectId}`);
  } else {
    return { mode: "skipped", reason: "identity_missing", table: "hot_leads" };
  }

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
  });
  const json = await response.json().catch(() => null);
  return response.ok
    ? { mode: "live_patch", table: "hot_leads", rows: json }
    : { mode: "live_patch_failed", table: "hot_leads", status: response.status, error: json };
}

async function suppressContact(input = {}) {
  const phone = normalizedPhone(input.phone);
  const email = normalizedEmail(input.email);
  const prospectId = cleanString(input.prospectId, 160);
  const reportId = cleanString(input.reportId, 160);
  const source = cleanString(input.source, 120) || "contact_opt_out";
  const reason = cleanString(input.reason, 120) || "contact_opt_out";
  const channels = {
    call: Boolean(input.channels?.call),
    text: Boolean(input.channels?.text),
    email: Boolean(input.channels?.email),
  };
  const key = consentKey({ phone, email, prospectId, reportId });
  if (!key) {
    const error = new Error("A phone, email, prospect ID, or report ID is required for suppression");
    error.statusCode = 400;
    error.code = "suppression_identity_required";
    throw error;
  }

  const now = new Date().toISOString();
  const suppression = await upsertRow(
    "ghost_agency_suppressions",
    {
      suppression_key: phone || email || prospectId || reportId,
      email: email || null,
      prospect_id: prospectId || null,
      reason,
      source,
      payload: {
        channels,
        reportId: reportId || null,
        ...(input.payload || {}),
      },
      updated_at: now,
    },
    "suppression_key",
  );

  const consentRow = {
    consent_key: key,
    report_id: reportId || null,
    prospect_id: prospectId || null,
    business: cleanString(input.business, 180) || null,
    email: email || null,
    phone: phone || null,
    source,
    payload: {
      reason,
      channels,
      ...(input.payload || {}),
    },
    updated_at: now,
  };
  if (channels.call) consentRow.consent_to_call = false;
  if (channels.text) consentRow.consent_to_text = false;

  const consent = await upsertRow("consent_registrar", consentRow, "consent_key");
  const hotLeadPatch = { updated_at: now };
  if (channels.call) {
    hotLeadPatch.consent_to_call = false;
    hotLeadPatch.call_now_enabled = false;
    hotLeadPatch.status = "hot_lead_opted_out";
  }
  if (channels.text) hotLeadPatch.consent_to_text = false;
  const hotLeads = await patchHotLeads({ phone, email, prospectId, reportId }, hotLeadPatch);

  return { suppression, consent, hotLeads, channels };
}

module.exports = { suppressContact };
