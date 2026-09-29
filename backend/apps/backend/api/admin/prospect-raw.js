"use strict";

// api/admin/prospect-raw.js — OPERATOR DIAGNOSTIC (2026-09-01): the durable
// prospect record, byte-for-byte, for the sender-evidence investigation.
// Admin-gated like every /api/admin route; POST so the id never lands in a
// URL; no-store. Reads ONE row from the prospects table. It never writes.

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    const body = await readJson(req, { limit: "16kb" });
    const prospectId = String((body && body.prospectId) || "").trim();
    if (!prospectId) {
      sendJson(res, 400, { ok: false, error: "prospect_id_required" });
      return;
    }
    const read = await select(
      "ghost_agency_prospects",
      `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
    if (!read || read.ok !== true || !Array.isArray(read.data) || !read.data.length) {
      sendJson(res, 404, { ok: false, error: "prospect_not_found", prospectId });
      return;
    }
    // The line pipeline persists build evidence to the LINE row, not the
    // prospect record (production-proven 2026-09-01: prospect status stays
    // "new" with zero build_dispatch while the line row carries it all).
    // Return the raw line rows too — the sender-evidence investigation
    // needs both stores side by side.
    const lineRead = await select(
      "ghost_agency_line_batch_rows",
      `?select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&order=updated_at.desc&limit=3`,
    ).catch(() => null);
    sendJson(res, 200, {
      ok: true,
      prospectId,
      record: read.data[0],
      lineRows: (lineRead && lineRead.ok === true && Array.isArray(lineRead.data)) ? lineRead.data : [],
    });
  } catch (error) {
    handleError(req, res, error, "prospect_raw_failed");
  }
};
