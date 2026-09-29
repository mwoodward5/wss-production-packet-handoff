"use strict";
// scripts/fleet-list.js — what is actually live, by vertical, with the client's
// own site next to it. Read-only. Prints TSV so a rebuild spread can be picked
// from the fleet rather than from memory.
//
//   node scripts/fleet-list.js
//   node scripts/fleet-list.js --json artifacts/fleet-list.json

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

async function rest(query) {
  const r = await fetch(`${BASE}/rest/v1/${query}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}

async function main() {
  const select = "id,business_name,industry,city,state,current_website,preview_url,status,updated_at,site_slug";
  const rows = await rest(
    `ghost_agency_prospects?select=${encodeURIComponent(select)}&preview_url=not.is.null&order=updated_at.desc&limit=500`,
  );
  const byVertical = new Map();
  for (const row of rows) {
    const v = String(row.industry || "?").toLowerCase();
    if (!byVertical.has(v)) byVertical.set(v, []);
    byVertical.get(v).push(row);
  }
  console.log(`live preview_urls: ${rows.length}`);
  for (const [v, list] of [...byVertical.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n== ${v}  (${list.length})`);
    for (const r of list.slice(0, 8)) {
      console.log(`  ${String(r.status || "").padEnd(14)} ${String(r.business_name).slice(0, 46).padEnd(48)} ${r.preview_url}`);
      console.log(`  ${" ".repeat(14)} own: ${r.current_website || "(none)"}   updated ${r.updated_at}`);
    }
  }
  const out = arg("json", "");
  if (out) {
    const p = path.isAbsolute(out) ? out : path.join(__dirname, "..", out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rows, null, 1));
    console.log(`\nwrote ${p}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
