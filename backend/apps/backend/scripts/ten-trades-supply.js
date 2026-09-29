"use strict";
// scripts/ten-trades-supply.js — read-only. What does the store hold, per
// trade, that the lane could BUILD today? Counts by industry x status, then
// for each buildable vertical outside the plumbing/hvac fleet prints the
// freshest candidate rows with the facts a build needs (name, city, site,
// logo, services, email) so a pick is made from evidence.
require("./brightdata-edit-proof/env").loadEnv();

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { resolveBuildableDonor } = require("../lib/lead-miner");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function servicesOf(rec, row) {
  const br = isObj(rec.build_ready) ? rec.build_ready : {};
  const req = isObj(br.mirror_request) ? br.mirror_request : {};
  const lmr = isObj(rec.leadminer_mirror_ready) ? rec.leadminer_mirror_ready : {};
  const pools = [row.primary_services, isObj(req.content) ? req.content.services : null, lmr.services];
  for (const p of pools) if (Array.isArray(p) && p.length) return p.length;
  return 0;
}
function logoOf(rec) {
  const br = isObj(rec.build_ready) ? rec.build_ready : {};
  const req = isObj(br.mirror_request) ? br.mirror_request : {};
  const lmr = isObj(rec.leadminer_mirror_ready) ? rec.leadminer_mirror_ready : {};
  const cands = [isObj(req.brand) ? req.brand.logo : "", isObj(br.brand) ? br.brand.logo : "", rec.logo_url, rec.logo, lmr.logo_url];
  for (const c of cands) if (typeof c === "string" && c.trim()) return c.trim();
  return "";
}

const WANT = ["concrete", "electrical", "electrician", "tattoo", "medspa", "med spa", "medical spa", "salon", "nail salon", "roofing", "fencing", "landscaping"];

(async () => {
  const rows = await rest("ghost_agency_prospects?select=id,business_name,industry,city,state,status,preview_url,current_website,email,record,primary_services,updated_at&order=updated_at.desc&limit=1000");
  const byTrade = new Map();
  for (const row of rows) {
    const ind = String(row.industry || "").toLowerCase().trim() || "?";
    if (!byTrade.has(ind)) byTrade.set(ind, []);
    byTrade.get(ind).push(row);
  }
  console.log("== store counts (1000 freshest rows), industry -> total / unbuilt");
  for (const [ind, list] of [...byTrade.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const unbuilt = list.filter((r) => !r.preview_url).length;
    console.log(`  ${ind.padEnd(28)} ${String(list.length).padStart(4)} total  ${String(unbuilt).padStart(4)} unbuilt`);
  }
  console.log("\n== candidates in wanted verticals (freshest first)");
  for (const want of WANT) {
    const list = (byTrade.get(want) || []);
    if (!list.length) continue;
    const donor = resolveBuildableDonor(want);
    console.log(`\n-- ${want}: donor=${donor.ok ? donor.donor : `NO (${donor.reason})`}`);
    for (const row of list.slice(0, 6)) {
      const rec = row.record || {};
      console.log(`   ${row.id.slice(0, 8)}  ${String(row.business_name || "").slice(0, 38).padEnd(38)} ${String(row.city || "").slice(0, 14).padEnd(14)} ${String(row.state || "").padEnd(3)} status=${String(row.status || "").padEnd(16)} site=${row.current_website ? "y" : "-"} logo=${logoOf(rec) ? "y" : "-"} svcs=${servicesOf(rec, row)} built=${row.preview_url ? "y" : "-"}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
