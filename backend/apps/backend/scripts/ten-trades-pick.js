"use strict";
// scripts/ten-trades-pick.js — pick ONE buildable candidate per missing trade
// and write artifacts/ten-trades-pick.json in the shape varied-markets-run
// reads ({ picked: [{id, name, industry}] }). Read-only against the store.
require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}

// Trade -> preferred names in order (from the supply survey; site+logo first,
// unbuilt first). Salon/med spa hold ONLY legacy-built rows, so those rebuild
// the real prospect through the current lane instead.
const PICKS = [
  ["concrete", ["Cox Concrete & Excavation", "Benchmark Concrete", "Capital City Concrete"]],
  ["tattoo", ["Refined Ink Tattoo Studio", "Lamar Street Tattoo Club", "Royal Ink Tattoos and Piercings OKC"]],
  ["med spa", ["Azure Med Spa"]],
  ["salon", ["Salon Icon"]],
  ["fencing", ["Hernandez Iron Works", "Pioneer Fence Co., Inc"]],
  ["landscaping", ["Landscape Connection, Inc.", "Richard Diaz Landscape", "Signature Landscape"]],
];

(async () => {
  const picked = [];
  for (const [industry, names] of PICKS) {
    let hit = null;
    for (const name of names) {
      const safe = encodeURIComponent(`%${name.replace(/[%,]/g, " ").trim()}%`);
      const rows = await rest(`ghost_agency_prospects?select=id,business_name,industry,city,state,status,preview_url,current_website&business_name=ilike.${safe}&limit=3`);
      const row = (Array.isArray(rows) ? rows : []).find((r) => String(r.industry || "").toLowerCase() === industry) || (Array.isArray(rows) ? rows[0] : null);
      if (row) { hit = row; break; }
    }
    if (hit) picked.push({ id: hit.id, name: hit.business_name, industry, city: hit.city, state: hit.state, built: !!hit.preview_url, site: hit.current_website || "" });
    else picked.push({ id: null, name: names[0], industry, missing: true });
  }
  // roofing: freshest UNBUILT roofing row with a real site.
  const roof = await rest("ghost_agency_prospects?select=id,business_name,industry,city,state,status,preview_url,current_website&industry=eq.roofing&preview_url=is.null&current_website=not.is.null&order=updated_at.desc&limit=5");
  if (Array.isArray(roof) && roof.length) {
    const r = roof[0];
    picked.push({ id: r.id, name: r.business_name, industry: "roofing", city: r.city, state: r.state, built: false, site: r.current_website || "" });
  }
  const out = { picked: picked.filter((p) => p.id) };
  fs.writeFileSync(path.join(__dirname, "..", "artifacts", "ten-trades-pick.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ picked, skipped: picked.filter((p) => !p.id) }, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
