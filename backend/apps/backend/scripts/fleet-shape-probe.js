"use strict";
// scripts/fleet-shape-probe.js — read-only: what does a prospect row ACTUALLY
// carry? Printed from real rows so a picker is written against the store's
// shape rather than against a guess about it.
require("./brightdata-edit-proof/env").loadEnv();
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}
const walk = (o, p = "", d = 0, out = []) => {
  if (d > 3 || o === null || typeof o !== "object") return out;
  for (const k of Object.keys(o)) {
    const v = o[k]; const key = p ? `${p}.${k}` : k;
    if (Array.isArray(v)) { out.push(`${key}[] = ${v.length}${v.length && typeof v[0] !== "object" ? ` e.g. ${JSON.stringify(v[0]).slice(0, 70)}` : ""}`); if (v.length && typeof v[0] === "object") walk(v[0], `${key}[0]`, d + 1, out); }
    else if (v && typeof v === "object") { out.push(`${key}{}`); walk(v, key, d + 1, out); }
    else out.push(`${key} = ${JSON.stringify(v).slice(0, 90)}`);
  }
  return out;
};
(async () => {
  const name = process.argv[2] || "Summit Heat";
  const rows = await rest(`ghost_agency_prospects?select=*&business_name=ilike.*${encodeURIComponent(name)}*&limit=1`);
  if (!rows.length) { console.log("no row"); return; }
  const row = rows[0];
  console.log("== columns:", Object.keys(row).join(", "));
  console.log("\n== preview_url:", row.preview_url);
  console.log("== site_slug:", row.site_slug, " status:", row.status, " industry:", row.industry);
  console.log("\n== record tree:");
  for (const line of walk(row.record || {})) console.log("  " + line);
})().catch((e) => { console.error(e); process.exit(1); });
