"use strict";

// lib/mirror-engine/migrate-housing.js — the paid half of HOTLINK-UNTIL-PAY
// (docs/standards/hotlink-until-pay.md).
//
// An unpaid prospect's preview ships their OWN verified media URLs
// (media_mode:"origin", assets/wss-origin-media.json) so we house none of
// their bytes. The moment they pay, that arrangement has an expiry date: they
// will cancel the old provider, the origin host dies, and every hotlinked URL
// 404s — taking the site we just sold them with it. So checkout enqueues a
// media_housing_migration job (lib/fulfillment.js, the Stripe webhook's
// verified-completion path) and THIS module is the drain half: it re-mirrors
// the prospect with media_mode:"housed", which re-fetches every origin URL,
// re-verifies the bytes and places them into the donor's slots first-party —
// same slug, same hostname, one build.
//
// The re-mirror re-verifies rather than trusts: resolveBrandAssets fetches
// each URL again and hashes it, so an origin file that CHANGED since the
// preview build is caught as new content (the build hash moves with it),
// never silently re-housed as the bytes the prospect never approved.
//
// Idempotent and auditable: the enqueue is keyed (job_id, delivery_type), and
// every run records a media_housing_migration event with the outcome.

const { select, recordEvent } = require("../store");
const { buildMirrorForProspect } = require("../mirror-lane-build");

/**
 * Map a stored ghost_agency_prospects row onto the lane's prospect shape —
 * the same mapping scripts/rebuild-prospect.js drives by hand, so a migration
 * rebuild and an operator rebuild ask the lane exactly the same question.
 */
function prospectFromStoredRow(row = {}) {
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  return {
    ...row,
    record,
    business_name: f.business_name || row.business_name,
    industry: f.industry || row.industry,
    city: f.city || row.city,
    state: f.state || row.state,
    current_website: f.current_website || row.current_website,
    site: row.current_website || f.current_website || "",
    email: f.email || row.email,
    phone: f.phone || row.phone,
    place_id: f.place_id || record.place_id,
    rating: f.rating ?? record.rating,
    review_count: f.review_count ?? record.review_count,
    marketing_city: f.service_area || record.service_area,
    logo_url: brand.logo || "",
    logo_accent: brand.accent || "",
    logo_accent_source: brand.accent_source || "",
    ...(row.truth_packet ? { truth_packet: row.truth_packet } : {}),
    ...(record.truth_packet ? { truth_packet: record.truth_packet } : {}),
  };
}

/**
 * Load the stored prospect row for a migration job. The checkout job carries a
 * prospect id when the pitch path created one; otherwise the business name is
 * the join key (exactly how an operator finds the row by hand).
 */
async function loadProspectRow({ prospectId = "", businessName = "" }, selectImpl = select) {
  if (prospectId) {
    const byId = await selectImpl(
      "ghost_agency_prospects",
      `select=*&prospect_id=eq.${encodeURIComponent(prospectId)}&limit=1`,
    );
    if (byId?.ok && Array.isArray(byId.data) && byId.data.length) return byId.data[0];
  }
  if (!businessName) return null;
  const byName = await selectImpl(
    "ghost_agency_prospects",
    `select=*&business_name=ilike.*${encodeURIComponent(businessName)}*&limit=1`,
  );
  return byName?.ok && Array.isArray(byName.data) && byName.data.length ? byName.data[0] : null;
}

/**
 * runHousingMigration({ job }) — re-mirror one prospect with media_mode:"housed".
 * `job` is the checkout job payload the fulfillment queue row carries
 * ({ id, prospect: { id | prospect_id, businessName } }). deps are injectable
 * like every lane boundary: { select, recordEvent, buildMirrorForProspect }.
 */
async function runHousingMigration({ job = {}, deps = {} } = {}) {
  const _select = deps.select || select;
  const _recordEvent = deps.recordEvent || recordEvent;
  const _build = deps.buildMirrorForProspect || buildMirrorForProspect;
  const jobId = String(job.id || job.job_id || "").trim();
  const prospectId = String(job.prospect?.id || job.prospect?.prospect_id || "").trim();
  const businessName = String(job.prospect?.businessName || job.prospect?.business_name || "").trim();

  let row = null;
  try {
    row = await loadProspectRow({ prospectId, businessName }, _select);
  } catch (error) {
    const report = { ok: false, mode: "prospect_load_failed", jobId, reason: String(error.message || error).slice(0, 200) };
    await _recordEvent("media_housing_migration", report).catch(() => {});
    return report;
  }
  if (!row) {
    const report = { ok: false, mode: "prospect_not_found", jobId, prospectId, businessName };
    await _recordEvent("media_housing_migration", report).catch(() => {});
    return report;
  }

  const out = await _build(prospectFromStoredRow(row), { mediaMode: "housed" });
  const report = {
    ok: !!out.ok,
    mode: "re_mirror_housed",
    jobId,
    prospectId: prospectId || String(row.prospect_id || ""),
    businessName: row.business_name || businessName,
    slug: out.slug || "",
    revealable: !!out.revealable,
    preview_url: out.preview_url || "",
    build_hash: out.build_hash || "",
    reason: out.reason || "",
  };
  await _recordEvent("media_housing_migration", report).catch(() => {});
  return report;
}

module.exports = { runHousingMigration, loadProspectRow, prospectFromStoredRow };
