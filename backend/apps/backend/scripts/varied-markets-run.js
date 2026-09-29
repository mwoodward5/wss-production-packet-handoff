"use strict";
/**
 * scripts/varied-markets-run.js — rebuild a picked spread through the REAL lane
 * (lib/mirror-lane-build buildMirrorForProspect), keyed on ROW ID.
 *
 * WHY ID AND NOT NAME. The sibling runner matches on business_name with ilike,
 * and this spread contains "Carter's My Plumber - Plumbers Indianapolis",
 * "Pioneer Fence Co., Inc" and "Modern Furnace & Air Conditioning, LLC" —
 * apostrophes, commas and an ampersand, each of which is a PostgREST filter
 * metacharacter or an ilike wildcard hazard. A spread that silently rebuilds
 * the wrong row is worse than one that fails.
 *
 * REFUSALS ARE RESULTS and are printed as loudly as the successes.
 *
 *   node scripts/varied-markets-run.js --list artifacts/varied-markets.json
 *   node scripts/varied-markets-run.js --ids <uuid>,<uuid>
 */

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const OUT = arg("out", "artifacts/varied-markets-run.json");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
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
  let ids = arg("ids", "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = arg("list", "");
  let picked = [];
  if (list) {
    const p = path.isAbsolute(list) ? list : path.join(ROOT, list);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    picked = Array.isArray(j) ? j : (j.picked || []);
    ids = picked.map((x) => x.id);
  }
  if (!ids.length) { console.error("--ids or --list required"); process.exit(2); }

  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const { clientSurfaceOf } = require("../lib/client-surface");

  const results = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const meta = picked.find((x) => x.id === id) || {};
    const rows = await rest(`ghost_agency_prospects?select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!Array.isArray(rows) || !rows.length) {
      console.log(`\n[${i + 1}/${ids.length}] ${meta.name || id}\n   NO ROW — nothing to rebuild`);
      results.push({ id, name: meta.name || "", ok: false, reason: "no_row" });
      continue;
    }
    const row = rows[0];
    const prospect = prospectFromRow(row);
    let surface = { reason: "", surface: null };
    try { surface = clientSurfaceOf(prospect); } catch { /* measurement only */ }
    console.log(`\n[${i + 1}/${ids.length}] ${row.business_name}  (${meta.trade || row.industry}, ${row.city}, ${row.state})`);
    console.log(`   client surface: ${surface.reason}`);
    const t0 = Date.now();
    let out;
    try {
      out = await buildMirrorForProspect(prospect, {});
    } catch (e) {
      out = { ok: false, reason: `threw:${String(e.message || e).slice(0, 200)}` };
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const rec = {
      id, name: row.business_name,
      expectedTrade: meta.trade || "", label: row.industry || "",
      city: row.city, state: row.state,
      // The town the page will actually name. It is often NOT the postal city
      // (Republic, MO markets itself as Springfield), and a verifier that only
      // knows the postal one reports a correct headline as a defect.
      marketingCity: prospect.marketing_city || "",
      own: row.current_website || "", bankedPhotos: meta.photos ?? null,
      secs: Number(secs),
      client_surface_reason: surface.reason,
      client_surface_mode: surface.surface ? surface.surface.mode : "",
      ok: !!out.ok, revealable: !!out.revealable,
      reason: out.reason || "", detail: out.detail || "",
      donor: out.donor || "", vertical: out.vertical || "",
      url: out.preview_url || row.preview_url || "",
      contentCoverage: out.contentCoverage || null,
    };
    results.push(rec);
    console.log(`   ${rec.ok ? "BUILT" : "REFUSED"} in ${secs}s  revealable=${rec.revealable}  donor=${rec.donor}  vertical=${rec.vertical}`);
    if (rec.vertical && meta.trade && rec.vertical !== meta.trade) {
      console.log(`   *** TRADE MOVED: expected ${meta.trade}, built ${rec.vertical} ***`);
    }
    if (rec.reason) console.log(`   reason: ${rec.reason}${rec.detail ? ` — ${rec.detail}` : ""}`);
    if (rec.contentCoverage) console.log(`   coverage: ${JSON.stringify(rec.contentCoverage)}`);
    console.log(`   ${rec.url}`);

    const p = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(results, null, 1));
  }

  const built = results.filter((r) => r.ok).length;
  const revealable = results.filter((r) => r.revealable).length;
  console.log(`\n=== ${built}/${results.length} built, ${revealable} revealable (mailable) ===`);
  for (const r of results.filter((x) => !x.revealable)) {
    console.log(`  NOT MAILABLE  ${r.name}: ${r.reason || "unknown"}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  const moved = results.filter((r) => r.vertical && r.expectedTrade && r.vertical !== r.expectedTrade);
  console.log(moved.length ? `\n  TRADE MOVED on ${moved.length}: ${moved.map((r) => `${r.name} ${r.expectedTrade}->${r.vertical}`).join("; ")}` : `\n  trade held on all ${results.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
