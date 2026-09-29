"use strict";

// Admin-gated: mint signed 45-day checkout redirect links for prospects.
// Used when bulk-loading warmup prospects so each email carries a durable
// checkout_url (redirects to a fresh Stripe session on click).

const { requireAdmin } = require("../../lib/admin-auth");
const { handleError, methodGuard, readJson, sendJson } = require("../../lib/http");
const { buildCheckoutLink, checkoutLinkStatus } = require("../../lib/checkout-links");
const { buildReportLink } = require("../../lib/report-links");
const { select, upsertRow } = require("../../lib/store");

// If the caller (the admin console, after building a prospect's preview
// site) already knows its real Vercel project name and/or the domain the
// business wants, persist those onto the prospect's own DB row. This is
// read back live at checkout-link click time (api/checkout-link.js,
// api/launch.js) and forwarded into Stripe metadata so a paid domain
// purchase (lib/domains.js fulfillDomainForJob) has something real to
// attach to instead of silently no-oping. Best-effort: a write failure here
// must never block minting the checkout link itself.
async function persistPreviewIdentity(prospectId, { previewProjectName, desiredDomain }) {
  if (!prospectId || (!previewProjectName && !desiredDomain)) return;
  try {
    const found = await select(
      "ghost_agency_prospects",
      `prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
    const existing = found && found.ok && Array.isArray(found.data) ? found.data[0] : null;
    const record = { ...((existing && existing.record) || {}) };
    if (previewProjectName) record.preview_project_name = previewProjectName;
    if (desiredDomain) record.desired_domain = desiredDomain;
    await upsertRow(
      "ghost_agency_prospects",
      { prospect_id: prospectId, record, updated_at: new Date().toISOString() },
      "prospect_id",
    );
  } catch {
    // Best-effort only -- see comment above.
  }
}

module.exports = async function handler(req, res) {
  if (!methodGuard(req, res, ["GET", "POST"])) return;
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === "GET") {
      sendJson(res, 200, { ok: true, route: "admin/mint-checkout-links", ...checkoutLinkStatus() });
      return;
    }
    const body = await readJson(req);
    const prospects = Array.isArray(body && body.prospects) ? body.prospects : [];
    if (!prospects.length) {
      sendJson(res, 400, { ok: false, error: "no_prospects" });
      return;
    }
    const links = await Promise.all(prospects.map(async (p) => {
      const prospectId = String(p.prospect_id || p.slug || "").trim();
      const previewProjectName = String(p.preview_project_name || p.previewProjectName || "").trim();
      const desiredDomain = String(p.desired_domain || p.desiredDomain || "").trim().toLowerCase();
      await persistPreviewIdentity(prospectId, { previewProjectName, desiredDomain });
      const url = buildCheckoutLink({
        prospect: {
          prospect_id: prospectId,
          business_name: p.business_name || p.name || "Local Business",
          industry: p.industry || "landscaping",
          city: p.city || "",
          state: p.state || "CA",
        },
        job: { id: p.job_id || `warmup-${prospectId}` },
      });
      // Also mint a signed report link so owner-proof emails can carry the
      // full compliant template (report + checkout) without exposing secrets.
      const reportUrl = buildReportLink({
        prospect_id: prospectId,
        business_name: p.business_name || p.businessName || "",
        city: p.city || "",
        industry: p.industry || "",
        current_website: p.current_website || p.website || "",
        preview_url: p.preview_url || "",
        record: p.record || {},
      });
      return { prospect_id: prospectId, checkout_url: url || null, report_url: reportUrl || null };
    }));
    sendJson(res, 200, { ok: links.every((l) => l.checkout_url), ...checkoutLinkStatus(), links });
  } catch (error) {
    handleError(res, error);
  }
};
