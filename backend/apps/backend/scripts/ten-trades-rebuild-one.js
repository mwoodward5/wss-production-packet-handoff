"use strict";
// Rebuild ONE stored prospect through the real lane, by id. Same prospect
// shape as varied-markets-run. Used for the ten-trades floater proof: run with
// GHOST_AGENT_PHONE set so resolveSignupConfig has a Riley line and the panel
// ships (this machine's env lacks it; production has it).
//
//   node scripts/ten-trades-rebuild-one.js --id <uuid>
require("./brightdata-edit-proof/env").loadEnv();

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  return JSON.parse(await r.text());
}

(async () => {
  const id = arg("id");
  if (!id) { console.error("--id required"); process.exit(2); }
  const rows = await rest(`ghost_agency_prospects?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!rows.length) { console.error("no row"); process.exit(2); }
  const row = rows[0];
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
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
  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const t0 = Date.now();
  const out = await buildMirrorForProspect(prospect, {});
  console.log(JSON.stringify({
    ok: out.ok, revealable: out.revealable, url: out.preview_url,
    reason: out.reason, donor: out.donor, vertical: out.vertical,
    secs: Number(((Date.now() - t0) / 1000).toFixed(1)),
    signup_panel: out.checks && out.checks.content && out.checks.content.signup_panel
      ? out.checks.content.signup_panel
      : (out.content_report && out.content_report.signup_panel) || null,
    render: out.checks && out.checks.render ? { status: out.checks.render.status, problems: out.checks.render.problems } : null,
  }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
