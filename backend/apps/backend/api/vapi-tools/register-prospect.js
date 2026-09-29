"use strict";

// VAPI tool / admin endpoint: upserts a prospect record into
// ghost_agency_prospects so Riley can look a caller up mid-call by phone,
// business name, or a short human-readable reference code. Secret-gated the
// same way as lookup-prospect (VAPI_TOOL_SECRET, VAPI_WEBHOOK_SECRET, or admin
// token). Writing a row never sends anything; the CAN-SPAM gates in
// lib/email.js still govern every actual send.
const { timingSafeEqual, createHash } = require("node:crypto");
const { upsertRow, recordEvent } = require("../../lib/store");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");

function authorized(req) {
  const secrets = [process.env.VAPI_WEBHOOK_SECRET, process.env.VAPI_TOOL_SECRET, process.env.GHOST_AGENCY_ADMIN_TOKEN]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  const got = String(req.headers["x-vapi-secret"] || req.headers["x-admin-token"] || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "").trim();
  if (!secrets.length || !got) return false;
  const g = Buffer.from(got);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return g.length === b.length && timingSafeEqual(g, b);
  });
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function slugify(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Stable 6-char A-Z0-9 reference derived from business + city, so re-registering
// the same business yields the same code Riley can read back to a caller.
function referenceFor(businessName, city) {
  const seed = `${slugify(businessName)}|${slugify(city)}`;
  const hex = createHash("sha256").update(seed).digest("hex");
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!authorized(req)) return sendJson(res, 401, { ok: false, error: "unauthorized" });
  try {
    const body = await readJson(req).catch(() => ({}));
    // VAPI wraps tool args; accept both wrapped and direct forms.
    const call = body?.message?.toolCalls?.[0];
    const args = call?.function?.arguments
      ? (typeof call.function.arguments === "string" ? JSON.parse(call.function.arguments) : call.function.arguments)
      : body;

    const businessName = String(args.business_name || args.name || "").trim();
    if (!businessName) {
      const err = { ok: false, error: "missing_business_name", message: "business_name is required." };
      if (call?.id) return sendJson(res, 200, { results: [{ toolCallId: call.id, result: JSON.stringify(err) }] });
      return sendJson(res, 400, err);
    }

    const city = String(args.city || "").trim();
    const state = String(args.state || "").trim();
    const reference = referenceFor(businessName, city);
    const prospectId = slugify(`${businessName}-${city || state || ""}`) || slugify(businessName) || reference.toLowerCase();

    const weaknesses = Array.isArray(args.weaknesses) ? args.weaknesses.map((w) => String(w)).filter(Boolean) : [];
    const rating = args.rating === undefined || args.rating === null || args.rating === "" ? null : Number(args.rating);
    const reviewCount = args.review_count === undefined || args.review_count === null || args.review_count === ""
      ? null : Number(args.review_count);

    // Build the record (jsonb mirror) so reference/preview/report survive even
    // if the physical columns are absent — store.js self-heals a missing
    // optional `reference` column by falling back to this mirror.
    const record = {
      business_name: businessName,
      city: city || null,
      state: state || null,
      industry: String(args.industry || "").trim() || null,
      current_website: String(args.current_website || "").trim() || null,
      preview_url: String(args.preview_url || "").trim() || null,
      report_url: String(args.report_url || "").trim() || null,
      phone: String(args.phone || "").trim() || null,
      rating,
      review_count: reviewCount,
      weaknesses,
      reference,
      source: "vapi-register",
    };

    const row = {
      prospect_id: prospectId,
      status: "previewed",
      business_name: businessName,
      city: city || null,
      state: state || null,
      industry: record.industry,
      current_website: record.current_website,
      phone: record.phone,
      preview_url: record.preview_url,
      report_url: record.report_url,
      // reference is the only "maybe-missing" top-level column we write; store.js
      // self-heals a PGRST204 by dropping it and relying on record.reference.
      reference,
      source: "vapi-register",
      // rating/review_count/weaknesses live only in the record mirror to avoid a
      // hard upsert failure if those physical columns don't exist.
      record,
      updated_at: new Date().toISOString(),
    };

    const persisted = await upsertRow("ghost_agency_prospects", row, "prospect_id");

    if (persisted.mode === "live_upsert_failed" || persisted.mode === "live_write_failed") {
      const err = {
        ok: false,
        error: "persist_failed",
        detail: persisted.error || null,
        status: persisted.status || null,
        diagnosticId: persisted.diagnosticId || null,
      };
      if (call?.id) return sendJson(res, 200, { results: [{ toolCallId: call.id, result: JSON.stringify(err) }] });
      return sendJson(res, 502, err);
    }

    await recordEvent("prospect.vapi_register", {
      actor: "vapi_register",
      status: "ok",
      prospect_id: prospectId,
      business_name: businessName,
      reference,
      mode: persisted.mode,
      preview_url: record.preview_url,
    }).catch(() => {});

    const result = { ok: true, reference, prospect_id: prospectId, mode: persisted.mode };
    if (call?.id) return sendJson(res, 200, { results: [{ toolCallId: call.id, result: JSON.stringify(result) }] });
    return sendJson(res, 200, result);
  } catch (error) {
    handleError(res, error);
  }
};
