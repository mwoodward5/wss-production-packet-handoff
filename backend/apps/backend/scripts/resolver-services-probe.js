"use strict";
/**
 * scripts/resolver-services-probe.js — ask the ENGINE'S OWN resolver what it
 * can see on a client's site, without building anything.
 *
 * Three rebuilds in a row came back `service_floor:no_services_resolved`. That
 * is either true (thin sites, which is who this product targets) or a resolver
 * that cannot reach them — and those two have opposite fixes, so the difference
 * has to be measured rather than assumed.
 *
 *   node scripts/resolver-services-probe.js --name "Titanium HVAC"
 */

require("./brightdata-edit-proof/env").loadEnv();

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

const { resolveVerifiedFacts } = require("../lib/mirror-engine/verified-facts");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}

async function main() {
  const id = arg("id", "");
  const name = arg("name", "");
  const q = id
    ? `ghost_agency_prospects?select=*&id=eq.${encodeURIComponent(id)}&limit=1`
    : `ghost_agency_prospects?select=*&business_name=ilike.*${encodeURIComponent(name)}*&limit=1`;
  const rows = await rest(q);
  if (!rows.length) { console.error("no row"); process.exit(2); }
  const row = rows[0];
  const rec = row.record || {};
  const req = (rec.build_ready && rec.build_ready.mirror_request) || {};
  const f = req.facts || {};

  console.log(`${row.business_name} — ${row.current_website}`);
  const t0 = Date.now();
  const v = await resolveVerifiedFacts({
    prospect: {
      prospect_id: row.prospect_id, business_name: row.business_name,
      industry: f.industry || row.industry,
      city: row.city, state: row.state,
      current_website: row.current_website,
      email: row.email, place_id: f.place_id || rec.place_id,
      row,
    },
  });
  console.log(`resolved in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const content = (v && v.content) || {};
  console.log(`content keys: ${Object.keys(content).join(", ") || "(none)"}`);
  const svc = content.services;
  console.log(`services: ${Array.isArray(svc) ? svc.length : typeof svc}`);
  if (Array.isArray(svc)) for (const s of svc.slice(0, 15)) console.log(`   - ${JSON.stringify(s).slice(0, 120)}`);
  if (content.services_refused) console.log(`services_refused: ${JSON.stringify(content.services_refused).slice(0, 400)}`);
  for (const k of ["reviews", "hours", "faqs", "areas"]) {
    if (Array.isArray(content[k])) console.log(`${k}: ${content[k].length}`);
  }
  // The sources block says WHERE it looked and whether it got there.
  if (v && v.sources) {
    console.log(`\nsources:`);
    for (const [k, s] of Object.entries(v.sources)) {
      console.log(`  ${String(k).padEnd(26)} ${JSON.stringify(s).slice(0, 200)}`);
    }
  }
  if (v && v.fetches) console.log(`\nfetches: ${JSON.stringify(v.fetches).slice(0, 600)}`);
  if (v && v.diagnostics) console.log(`\ndiagnostics: ${JSON.stringify(v.diagnostics).slice(0, 600)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
