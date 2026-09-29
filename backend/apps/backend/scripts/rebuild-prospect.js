"use strict";
// Rebuild one stored prospect through the REAL lane, by name. Prints the
// content coverage the build actually assembled — including how many reviewer
// faces survived into the request.

require("./brightdata-edit-proof/env").loadEnv();

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (f, d) => (process.argv.includes(f) ? process.argv[process.argv.indexOf(f) + 1] : d);
const NAME = arg("--name", "");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return JSON.parse(await r.text());
}

async function main() {
  if (!NAME) { console.error("--name required"); process.exit(2); }
  const rows = await rest(
    `ghost_agency_prospects?select=*&business_name=ilike.*${encodeURIComponent(NAME)}*&limit=1`,
  );
  if (!rows.length) { console.error("no row"); process.exit(2); }
  const row = rows[0];
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  const storedReviews = (req.content && req.content.reviews) || [];
  console.log(`${row.business_name} — contract carries ${storedReviews.length} reviews, ${storedReviews.filter((r) => r.avatarUrl).length} with avatarUrl`);

  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const prospect = {
    ...row, record,
    business_name: f.business_name || row.business_name,
    industry: f.industry || row.industry,
    city: f.city || row.city, state: f.state || row.state,
    current_website: f.current_website || row.current_website,
    site: row.current_website || "",
    email: f.email || row.email, phone: f.phone || row.phone,
    place_id: f.place_id || record.place_id,
    rating: f.rating ?? record.rating,
    review_count: f.review_count ?? record.review_count,
    marketing_city: f.service_area || record.service_area,
    logo_url: brand.logo || "", logo_accent: brand.accent || "",
    logo_accent_source: brand.accent_source || "",
  };
  const t0 = Date.now();
  const out = await buildMirrorForProspect(prospect, {});
  console.log(`\nbuilt in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify({
    ok: out.ok, revealable: out.revealable, preview_url: out.preview_url,
    donor: out.donor, status: out.status, reason: out.reason,
    contentCoverage: out.contentCoverage,
  }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
