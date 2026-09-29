"use strict";
// Verifies the signed one-click #t= token from the activation email
// (see lib/dashboard-link.js) and hands back the shared Connect token.
const { handleError, methodGuard, sendJson } = require("../../lib/http");
const { verifyDashboardLink, signScopeToken } = require("../../lib/dashboard-link");
const { select, upsertRow } = require("../../lib/store");

function cors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = [
    "https://connect.wss-labs.com",
    "https://wss-ai.com",
    "https://www.wss-ai.com",
  ];
  if (allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!methodGuard(req, res, ["GET"])) return;
  try {
    const t = String(req.query?.t || "").trim();
    const result = verifyDashboardLink(t);
    if (!result.ok) {
      sendJson(res, 401, { ok: false, error: result.reason });
      return;
    }
    let businessName = null;
    let visibilityBusiness = null;
    let scopedToken = "";
    try {
      const found = await select("ghost_agency_dashboard_access", `job_id=eq.${encodeURIComponent(result.jobId)}&limit=1`);
      const row = found?.ok && Array.isArray(found.data) ? found.data[0] : null;
      businessName = row?.business_name || null;
      visibilityBusiness = row?.visibility_business || null;
      if (row?.site_slug) scopedToken = signScopeToken(row.site_slug);
      if (row) {
        upsertRow(
          "ghost_agency_dashboard_access",
          { job_id: row.job_id, owner_email: row.owner_email, pin_hash: row.pin_hash, last_login_at: new Date().toISOString() },
          "job_id",
        ).catch(() => {});
      }
    } catch { /* best-effort; link is still valid even if the lookup row is missing */ }
    sendJson(res, 200, {
      ok: true,
      token: scopedToken,
      scoped: Boolean(scopedToken),
      jobId: result.jobId,
      businessName,
      visibilityBusiness,
    });
  } catch (error) {
    handleError(res, error);
  }
};
