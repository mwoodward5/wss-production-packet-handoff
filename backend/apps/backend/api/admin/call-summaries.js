const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { select } = require("../../lib/store");

function normalizeSummary(row) {
  const payload = row.payload || {};
  const summary = payload.summary || payload.structuredData || {};
  return {
    event_id: row.id,
    prospect_id: payload.prospect_id || payload.prospectId || payload.call?.metadata?.prospect_id || "",
    call_id: payload.call_id || payload.callId || payload.call?.id || "",
    ts: row.created_at,
    outcome: summary.outcome || "",
    interest_level: summary.interest_level ?? null,
    requested_edits: Array.isArray(summary.requested_edits) ? summary.requested_edits : [],
    objections: Array.isArray(summary.objections) ? summary.objections : [],
    preferred_callback: summary.preferred_callback || null,
    handoff_requested: Boolean(summary.handoff_requested),
    notes: summary.notes || "",
  };
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET"])) return;
  if (!requireAdmin(req, res)) return;

  try {
    const limit = Math.min(Number.parseInt(req.query?.limit || "30", 10) || 30, 100);
    const typeFilter = "type=eq.outreach.call_completed";
    const selectCols = "select=id,type,payload,created_at";
    const order = "order=created_at.desc";
    const response = await select("ghost_agency_events", `?${selectCols}&${typeFilter}&${order}&limit=${limit}`);

    if (!response.ok) {
      sendJson(res, 502, {
        ok: false,
        error: "call_summaries_select_failed",
        details: response,
      });
      return;
    }

    const prospectId = req.query?.prospect_id ? String(req.query.prospect_id) : "";
    let summaries = (response.data || []).map(normalizeSummary);
    if (prospectId) {
      summaries = summaries.filter((summary) => summary.prospect_id === prospectId);
    }

    sendJson(res, 200, {
      ok: true,
      summaries,
    });
  } catch (error) {
    handleError(res, error);
  }
};
