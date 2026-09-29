"use strict";

const { createHash } = require("node:crypto");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent, select, upsertRow } = require("../../lib/store");

function cleanString(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function firstString(input, names, max) {
  for (const name of names) {
    const value = cleanString(input[name], max);
    if (value) return value;
  }
  return "";
}

function stableReportId(input) {
  const supplied = firstString(input, ["report_id", "reportId", "id"], 160);
  if (supplied) return supplied;
  const seed = [
    firstString(input, ["business", "business_name", "businessName"], 160),
    firstString(input, ["owner_email", "ownerEmail", "email"], 160).toLowerCase(),
    firstString(input, ["phone"], 80),
    firstString(input, ["report_url", "reportUrl"], 500),
  ].join("|");
  return `report_${createHash("sha256").update(seed || String(Date.now())).digest("hex").slice(0, 16)}`;
}

function requestIpHash(req) {
  const forwarded = cleanString(req.headers["x-forwarded-for"], 500).split(",")[0].trim();
  const ip = forwarded || cleanString(req.socket?.remoteAddress, 120);
  if (!ip) return "";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

// This is an unauthenticated beacon that upserts a hot_leads row, so an abusive
// caller could try to mass-poison the sales queue. A generous per-IP cap blunts
// that without blocking real report opens (which are low-frequency per viewer).
// NOTE: call_now_enabled is still derived from a real consent_registrar lookup,
// never from beacon input, so a junk row can never auto-enable calling. Full
// per-link HMAC signing is deferred — it needs the report app to emit a signed
// token (that emitter lives in the Lovable-hosted report app).
const beaconHits = new Map();
function beaconRateLimited(key) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const entry = beaconHits.get(key) || { count: 0, start: now };
  if (now - entry.start > windowMs) { entry.count = 0; entry.start = now; }
  entry.count += 1;
  beaconHits.set(key, entry);
  return entry.count > 20;
}

function encodeValue(value) {
  return encodeURIComponent(value).replace(/\./g, "%2E");
}

function consentClauses(identity) {
  const clauses = [];
  if (identity.report_id) clauses.push(`report_id.eq.${encodeValue(identity.report_id)}`);
  if (identity.prospect_id) clauses.push(`prospect_id.eq.${encodeValue(identity.prospect_id)}`);
  if (identity.phone) clauses.push(`phone.eq.${encodeValue(identity.phone)}`);
  if (identity.owner_email) clauses.push(`email.eq.${encodeValue(identity.owner_email.toLowerCase())}`);
  return clauses;
}

async function lookupConsent(identity) {
  const clauses = consentClauses(identity);
  if (!clauses.length) {
    return {
      mode: "not_checked",
      consent_to_call: false,
      consent_to_text: false,
      consent_source: "",
      row: null,
    };
  }

  const result = await select(
    "consent_registrar",
    `select=*&or=(${clauses.join(",")})&order=updated_at.desc&limit=1`,
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  return {
    mode: result.mode,
    consent_to_call: Boolean(row?.consent_to_call || row?.call_consent || row?.consentToCall),
    consent_to_text: Boolean(row?.consent_to_text || row?.text_consent || row?.consentToText),
    consent_source: cleanString(row?.source || row?.consent_source, 160),
    row,
    error: result.error,
    status: result.status,
  };
}

async function existingOpenCount(reportId) {
  const result = await select(
    "hot_leads",
    `select=report_id,opened_count&report_id=eq.${encodeValue(reportId)}&limit=1`,
  );
  const row = result.ok && Array.isArray(result.data) ? result.data[0] : null;
  return Number(row?.opened_count || 0);
}

async function readBeaconInput(req) {
  if (req.method !== "GET") return readJson(req);
  const base = `https://${req.headers.host || "localhost"}`;
  const url = new URL(req.url || "/api/proof/report-open", base);
  return Object.fromEntries(url.searchParams.entries());
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (beaconRateLimited(requestIpHash(req) || "unknown")) {
    sendJson(res, 429, { ok: false, error: "rate_limited" });
    return;
  }
  try {
    const body = await readBeaconInput(req);
    const reportId = stableReportId(body);
    const prospectId = firstString(body, ["prospect_id", "prospectId", "lead_id", "leadId"], 160);
    const business = firstString(body, ["business", "business_name", "businessName", "company"], 180);
    const ownerName = firstString(body, ["owner_name", "ownerName", "contact_name", "contactName"], 180);
    const ownerEmail = firstString(body, ["owner_email", "ownerEmail", "email"], 240).toLowerCase();
    const phone = firstString(body, ["phone", "owner_phone", "ownerPhone"], 80);
    const reportUrl = firstString(body, ["report_url", "reportUrl", "url"], 800);
    const source = firstString(body, ["source"], 120) || "callprep_report_open";
    const openedAt = new Date().toISOString();
    const consent = await lookupConsent({
      report_id: reportId,
      prospect_id: prospectId,
      owner_email: ownerEmail,
      phone,
    });
    const previousCount = await existingOpenCount(reportId);
    const callNowEnabled = Boolean(consent.consent_to_call && phone);

    const row = {
      report_id: reportId,
      prospect_id: prospectId || null,
      business,
      business_name: business,
      owner_name: ownerName || null,
      owner_email: ownerEmail || null,
      email: ownerEmail || null,
      phone: phone || null,
      report_url: reportUrl || null,
      source,
      opened_count: previousCount + 1,
      last_opened_at: openedAt,
      consent_to_call: Boolean(consent.consent_to_call),
      consent_to_text: Boolean(consent.consent_to_text),
      consent_source: consent.consent_source || null,
      call_now_enabled: callNowEnabled,
      status: callNowEnabled ? "hot_lead_consent_ready" : "hot_lead_consent_blocked",
      payload: {
        referer: cleanString(req.headers.referer || req.headers.referrer, 800) || null,
        userAgent: cleanString(req.headers["user-agent"], 500) || null,
        ipHash: requestIpHash(req) || null,
        raw: body,
      },
      updated_at: openedAt,
    };

    const stored = await upsertRow("hot_leads", row, "report_id");
    await recordEvent("mission_control.report_open", {
      reportId,
      prospectId: prospectId || null,
      business,
      consentToCall: row.consent_to_call,
      consentToText: row.consent_to_text,
      callNowEnabled,
      hotLeadMode: stored.mode,
    });

    sendJson(res, stored.mode === "live_upsert_failed" ? 502 : 200, {
      ok: stored.mode !== "live_upsert_failed",
      report_id: reportId,
      business,
      enqueued: stored.mode !== "live_upsert_failed",
      call_now_enabled: callNowEnabled,
      consent: {
        to_call: row.consent_to_call,
        to_text: row.consent_to_text,
        source: row.consent_source,
        mode: consent.mode,
      },
      hotLead: stored,
    });
  } catch (error) {
    handleError(res, error);
  }
};
