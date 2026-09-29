"use strict";
/**
 * scripts/rebuild-spread-run.js — rebuild a named spread through the REAL lane
 * (lib/mirror-lane-build buildMirrorForProspect), one at a time, and report
 * what each build actually did.
 *
 * REFUSALS ARE RESULTS. A build that comes back `revealable:false` with
 * `service_floor:below_floor` has not failed to run — it has run and told the
 * truth about thin evidence. Those are printed as loudly as the successes,
 * because a spread that quietly drops its refusals is how "10 of 10 rebuilt"
 * gets reported for 6 sites and 4 excuses.
 *
 *   node scripts/rebuild-spread-run.js --names "Gunther Plumbing,Summit Heat"
 *   node scripts/rebuild-spread-run.js --list artifacts/rebuild-spread.json
 */

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const OUT = arg("out", "artifacts/rebuild-spread-run.json");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}

/** The same prospect shape scripts/rebuild-prospect.js hands the lane. */
function prospectFromRow(row) {
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  return {
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
}

async function main() {
  let names = arg("names", "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = arg("list", "");
  if (list) {
    const p = path.isAbsolute(list) ? list : path.join(ROOT, list);
    names = JSON.parse(fs.readFileSync(p, "utf8")).map((s) => s.name);
  }
  if (!names.length) { console.error("--names or --list required"); process.exit(2); }

  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const { clientSurfaceOf } = require("../lib/client-surface");

  const results = [];
  for (const name of names) {
    // encodeURIComponent, NOT a hand-rolled strip: "M & M Heating & Cooling"
    // needs its ampersands as %26 or PostgREST reads them as query separators
    // and the filter silently matches nothing.
    const rows = await rest(
      `ghost_agency_prospects?select=*&business_name=ilike.*${encodeURIComponent(name)}*&limit=1`,
    );
    if (!Array.isArray(rows) || !rows.length) {
      console.log(`\n== ${name}\n   NO ROW — nothing to rebuild`);
      results.push({ name, ok: false, reason: "no_row" });
      continue;
    }
    const row = rows[0];
    const prospect = prospectFromRow(row);
    const surface = clientSurfaceOf(prospect);
    console.log(`\n== ${row.business_name}  (${row.industry})`);
    console.log(`   client surface: ${surface.reason}`);
    const t0 = Date.now();
    let out;
    try {
      out = await buildMirrorForProspect(prospect, {});
    } catch (e) {
      out = { ok: false, reason: `threw:${String(e.message || e).slice(0, 160)}` };
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const rec = {
      name: row.business_name, id: row.id, industry: row.industry,
      own: row.current_website || "", secs: Number(secs),
      client_surface_reason: surface.reason,
      client_surface_mode: surface.surface ? surface.surface.mode : "",
      ok: !!out.ok, revealable: !!out.revealable, reason: out.reason || "",
      detail: out.detail || "", donor: out.donor || "", url: out.preview_url || row.preview_url || "",
      contentCoverage: out.contentCoverage || null,
    };
    results.push(rec);
    console.log(`   ${rec.ok ? "BUILT" : "REFUSED"} in ${secs}s  revealable=${rec.revealable}  donor=${rec.donor}`);
    if (rec.reason) console.log(`   reason: ${rec.reason}${rec.detail ? ` — ${rec.detail}` : ""}`);
    if (rec.contentCoverage) console.log(`   coverage: ${JSON.stringify(rec.contentCoverage)}`);
    console.log(`   ${rec.url}`);
  }

  const p = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(results, null, 1));

  const built = results.filter((r) => r.ok).length;
  const revealable = results.filter((r) => r.revealable).length;
  console.log(`\n=== ${built}/${results.length} built, ${revealable} revealable (mailable) ===`);
  for (const r of results.filter((x) => !x.revealable)) {
    console.log(`  NOT MAILABLE  ${r.name}: ${r.reason || "unknown"}`);
  }
  console.log(`wrote ${p}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
