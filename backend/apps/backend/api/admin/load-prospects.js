"use strict";

// Admin-gated bulk loader for pre-built prospects.
// Upserts fully-formed prospect rows (email + preview_url + status) into
// ghost_agency_prospects so the drip scheduler can pick them up. Intended for
// loading warmup batches whose preview sites were already built and deployed.
// This endpoint only writes rows; it never sends. The CAN-SPAM postal + working
// unsubscribe gates in lib/email.js still govern every actual send.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { recordEvent, upsertRow, selectRows } = require("../../lib/store");

const SENDABLE_STATUSES = ["previewed", "packeted", "reported"];

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;

  if (req.method === "GET") {
    let sendable = [];
    try {
      const result = await selectRows("ghost_agency_prospects", {
        select: "prospect_id,business_name,email,status,preview_url",
        order: "updated_at.desc",
        limit: 200,
      });
      const rows = Array.isArray(result && result.rows) ? result.rows : [];
      sendable = rows.filter((r) => SENDABLE_STATUSES.includes(r.status));
    } catch (_) { /* read best-effort */ }
    sendJson(res, 200, {
      ok: true,
      route: "admin/load-prospects",
      method: "POST",
      purpose: "Bulk-upsert pre-built prospects (email + preview_url) for the drip queue.",
      sendableCount: sendable.length,
      sendable,
      note: "Writing rows does not send. Postal + unsubscribe gates still govern all sends.",
    });
    return;
  }

  try {
    const body = await readJson(req);
    const input = Array.isArray(body && body.prospects) ? body.prospects : [];
    if (!input.length) {
      sendJson(res, 400, { ok: false, error: "no_prospects", message: "Provide a non-empty prospects[] array." });
      return;
    }

    const results = [];
    const errors = [];
    for (const p of input) {
      const prospectId = String(p.prospect_id || p.slug || "").trim();
      const email = (p.email || p.owner_email || "").trim();
      const previewUrl = (p.preview_url || "").trim();
      const status = SENDABLE_STATUSES.includes(p.status) ? p.status : "previewed";

      if (!prospectId) { errors.push({ prospect_id: null, error: "missing_prospect_id" }); continue; }
      if (!email) { errors.push({ prospect_id: prospectId, error: "missing_email" }); continue; }
      if (!previewUrl) { errors.push({ prospect_id: prospectId, error: "missing_preview_url" }); continue; }

      const persisted = await upsertRow(
        "ghost_agency_prospects",
        {
          prospect_id: prospectId,
          status,
          business_name: p.business_name || null,
          owner_name: p.owner_name || null,
          email,
          owner_email: email,
          phone: p.phone || null,
          current_website: p.current_website || null,
          industry: p.industry || "landscaping",
          city: p.city || null,
          state: p.state || null,
          primary_services: Array.isArray(p.primary_services) ? p.primary_services : [],
          leadminer_score: typeof p.leadminer_score === "number" ? p.leadminer_score : null,
          report_url: p.report_url || null,
          preview_url: previewUrl,
          source: p.source || "leadminer-warmup",
          record: p.record || p,
          updated_at: new Date().toISOString(),
        },
        "prospect_id",
      );
      results.push({ prospect_id: prospectId, status, mode: persisted.mode || persisted.status || "upserted" });
    }

    await recordEvent("prospect.bulk_load", {
      requested: input.length,
      loaded: results.length,
      failed: errors.length,
      statuses: [...new Set(results.map((r) => r.status))],
    });

    sendJson(res, errors.length && !results.length ? 400 : 200, {
      ok: results.length > 0,
      loaded: results.length,
      failed: errors.length,
      results,
      errors,
      note: "Rows are queued for the drip scheduler. Postal + unsubscribe gates still govern every send.",
    });
  } catch (error) {
    handleError(res, error);
  }
};
