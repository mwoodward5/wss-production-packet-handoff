"use strict";
/**
 * Assemble the verification list: the ten rebuilt hosts, each carrying the
 * MARKETING CITY the page will actually name.
 *
 * Without it the verifier reports a correct headline as a defect — Farr Better
 * Plumbing is registered in Republic, MO, self-publishes "Springfield", and the
 * lane deliberately prints "Plumbing in Springfield, MO". Two false failures
 * came from not knowing that, so the town the page is entitled to name is
 * joined in here from the store rather than guessed at render time.
 */
require("./brightdata-edit-proof/env").loadEnv();
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}

(async () => {
  const runs = arg("runs", "artifacts/varied-markets-run2.json,artifacts/chill-run.json").split(",");
  const byId = new Map();
  for (const rel of runs) {
    const p = path.join(ROOT, rel.trim());
    if (!fs.existsSync(p)) continue;
    // Later runs win: a rebuilt host replaces its earlier record.
    for (const r of JSON.parse(fs.readFileSync(p, "utf8"))) if (r.url) byId.set(r.id, r);
  }
  const rows = [...byId.values()].filter((r) => r.revealable);
  for (const r of rows) {
    if (r.marketingCity) continue;
    const [row] = await rest(`ghost_agency_prospects?select=record&id=eq.${encodeURIComponent(r.id)}&limit=1`);
    const rec = (row && row.record) || {};
    const req = (rec.build_ready && rec.build_ready.mirror_request) || {};
    r.marketingCity = (req.facts && req.facts.service_area) || rec.service_area || "";
  }
  const out = path.join(ROOT, arg("out", "artifacts/varied-markets-verify-list.json"));
  fs.writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log(`${rows.length} mailable host(s) -> ${out}`);
  for (const r of rows) {
    console.log(`  ${String(r.expectedTrade).padEnd(9)} ${String(r.name).slice(0, 34).padEnd(36)} ${r.city}, ${r.state}${r.marketingCity && r.marketingCity !== r.city ? `  (markets as ${r.marketingCity})` : ""}`);
  }
  fs.writeFileSync(path.join(ROOT, "artifacts/varied-markets-urls.txt"), rows.map((r) => r.url).join("\n") + "\n");
  console.log(`urls -> artifacts/varied-markets-urls.txt`);
})().catch((e) => { console.error(e); process.exit(1); });
