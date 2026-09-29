"use strict";

// lib/wss-connect-assets/magic-link.js — a REAL magic link into
// wss-ai.com/dashboard for a PROSPECT, using the same provisioning the paid
// activation path uses. Nothing here is a new login system:
//
//   * The link token is lib/dashboard-link.js signDashboardLink — the exact
//     #t= format api/connect/verify-link.js verifies.
//   * The account is a row in ghost_agency_dashboard_access — the exact table
//     lib/fulfillment.js writes at checkout. verify-link looks the row up by
//     job_id and, ONLY when it carries a site_slug, hands the browser a
//     scoped tenant token (lib/dashboard-link.js signScopeToken). Without
//     that row the dashboard's tryMagicLink() gets an empty token and falls
//     back to the login form — i.e. an unprovisioned link LOOKS dead. So
//     provisioning is not optional; it is what makes the link real.
//
// The job_id is namespaced "prospect-<prospect_id>" so a prospect row can
// never collide with a paid fulfillment row (those use the checkout job id).
// The PIN is deterministic (HMAC over the job id, same recipe as
// lib/fulfillment.js deterministicDashboardAccess) so re-provisioning the
// same prospect is idempotent: same row, same PIN, same link target.
//
// KNOWN EDGE, on purpose: api/connect/dashboard-login.js resolves email+PIN
// by owner_email with limit=1 and no ordering. If a prospect later BUYS with
// the same email, two rows share that owner_email and the email+PIN login
// becomes ambiguous. The magic link is unaffected (job_id lookup), which is
// why the email track leans on the link, not the PIN. Fixing the login
// ordering belongs to the auth surface, not to this helper.

const { createHmac } = require("node:crypto");
const { select, upsertRow } = require("../store");
const { hashPin, signDashboardLink } = require("../dashboard-link");
const { firstValue, prospectId, slugify } = require("../prospects");

const DASHBOARD_URL = "https://wss-ai.com/dashboard";
const PROSPECT_JOB_PREFIX = "prospect-";
const ACCESS_TABLE = "ghost_agency_dashboard_access";

function linkSecret() {
  return String(process.env.CONNECT_APP_TOKEN || process.env.GHOST_AGENCY_ADMIN_TOKEN || "").trim();
}

function prospectJobId(prospect) {
  const id = prospectId(prospect || {});
  return id ? `${PROSPECT_JOB_PREFIX}${slugify(id)}` : "";
}

/** Same recipe as fulfillment's deterministicDashboardAccess, own namespace. */
function deterministicProspectPin(jobId) {
  const secret = linkSecret();
  if (!secret || !jobId) return "";
  const digest = createHmac("sha256", secret)
    .update(`ghost-dashboard-pin:v1:${jobId}:prospect-preview`)
    .digest("hex");
  return String((Number.parseInt(digest.slice(0, 12), 16) % 900000) + 100000);
}

/**
 * The tenant scope slug for this prospect: the first label of their preview
 * host (wss-test-foo.wss-ai.com -> wss-test-foo), because that is the slug
 * the Connect surfaces key threads on. Falls back to the prospect id.
 */
function prospectSiteSlug(prospect = {}) {
  const preview = firstValue(prospect, ["preview_url", "previewUrl"], "");
  if (preview) {
    try {
      const host = new URL(preview).hostname;
      const label = host.split(".")[0];
      if (label) return slugify(label);
    } catch { /* fall through to the id */ }
  }
  return slugify(prospectId(prospect));
}

/** The business key the visibility panel greps scan history by. */
function prospectVisibilityBusiness(prospect = {}) {
  const site = firstValue(prospect, ["current_website", "currentWebsite", "website"], "");
  if (site) {
    try {
      return new URL(site).hostname.replace(/^www\./, "").toLowerCase();
    } catch { /* not a URL; fall through */ }
  }
  return firstValue(prospect, ["business_name", "businessName", "name"], "").toLowerCase();
}

/**
 * Provision (idempotently) and mint. Returns:
 *   { ok: true,  provisioned: true,  magicLink, dashboardUrl, jobId, siteSlug, pin }
 * or, when the secret or prospect identity is missing so a real link cannot
 * exist, the honest fallback the email copy can still render:
 *   { ok: false, provisioned: false, magicLink: "", dashboardUrl, reason }
 * Never returns a link shape that 404s: if the access row cannot be written,
 * the link is not returned either.
 */
async function prospectMagicLink(prospect, { ttlDays = 30 } = {}) {
  const jobId = prospectJobId(prospect);
  const siteSlug = prospectSiteSlug(prospect);
  if (!linkSecret()) {
    return { ok: false, provisioned: false, magicLink: "", dashboardUrl: DASHBOARD_URL, reason: "link_secret_missing" };
  }
  if (!jobId || !siteSlug) {
    return { ok: false, provisioned: false, magicLink: "", dashboardUrl: DASHBOARD_URL, reason: "prospect_identity_missing" };
  }

  const pin = deterministicProspectPin(jobId);
  const ownerEmail = firstValue(prospect, ["owner_email", "email", "ownerEmail"], "").toLowerCase();
  const businessName = firstValue(prospect, ["business_name", "businessName", "name"], "");

  // Keep an existing row's identity fields if a previous provision already
  // wrote them — upsert on job_id makes the whole call idempotent.
  const existing = await select(ACCESS_TABLE, `job_id=eq.${encodeURIComponent(jobId)}&limit=1`);
  const existingRow = existing?.ok && Array.isArray(existing.data) ? existing.data[0] : null;

  const row = {
    job_id: jobId,
    owner_email: ownerEmail || existingRow?.owner_email || null,
    business_name: businessName || existingRow?.business_name || null,
    site_slug: siteSlug,
    visibility_business: prospectVisibilityBusiness(prospect) || existingRow?.visibility_business || null,
    pin_hash: hashPin(pin),
  };
  // ONLY a live write earns a link. A dry-run (store unconfigured) would mint
  // a token whose signature verifies but whose access row does not exist, and
  // the dashboard's tryMagicLink() treats that exactly like a dead link — the
  // prospect lands on a login form they have no credentials for. That is the
  // "link shape that 404s" this helper exists to never return.
  const written = await upsertRow(ACCESS_TABLE, row, "job_id");
  if (written?.mode !== "live_upsert") {
    return {
      ok: false,
      provisioned: false,
      magicLink: "",
      dashboardUrl: DASHBOARD_URL,
      reason: `access_row_write_failed:${String(written?.mode || "unknown")}`,
    };
  }

  const token = signDashboardLink(jobId, ttlDays);
  return {
    ok: true,
    provisioned: true,
    magicLink: `${DASHBOARD_URL}#t=${token}`,
    dashboardUrl: DASHBOARD_URL,
    jobId,
    siteSlug,
    pin,
  };
}

module.exports = {
  DASHBOARD_URL,
  PROSPECT_JOB_PREFIX,
  deterministicProspectPin,
  prospectJobId,
  prospectMagicLink,
  prospectSiteSlug,
  prospectVisibilityBusiness,
};
