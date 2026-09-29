"use strict";
/**
 * scripts/rebuild-spread-pick.js — choose a REBUILD SPREAD from the fleet, by
 * evidence rather than by memory.
 *
 * The point of a spread is that it exercises different code, not different
 * names: one prospect per vertical (so a different donor is loaded each time),
 * and — deliberately — the one client whose OWN site measured dark, so the
 * theme's dark branch is exercised by a real business instead of by a flag.
 *
 * Read-only. Prints the spread and writes it as a --list for
 * scripts/theme-fleet-shots.js and scripts/rebuild-spread-run.js.
 *
 *   node scripts/rebuild-spread-pick.js --out artifacts/rebuild-spread.json
 */

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

async function rest(query) {
  const r = await fetch(`${BASE}/rest/v1/${query}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}

/** Which verticals the engine actually owns a sanitized donor for. */
function cleanDonorVerticals() {
  const dir = path.join(ROOT, "donors-clean");
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
}

const VERTICAL_OF = {
  hvac: "hvac", plumbing: "plumbing", roofing: "roofing", fencing: "fencing",
  landscaping: "landscaping", "landscaping & hardscaping": "landscaping",
  "med spa": "medspa", "medical spa": "medspa", salon: "salon", "nail salon": "salon",
  tattoo: "tattoo", concrete: "concrete", electrician: "electrician",
};

async function main() {
  const select = "id,business_name,industry,city,state,current_website,preview_url,status,updated_at,record";
  const rows = await rest(
    `ghost_agency_prospects?select=${encodeURIComponent(select)}&preview_url=not.is.null&order=updated_at.desc&limit=400`,
  );

  // The measured surfaces, so the dark client is picked because it MEASURED
  // dark and not because someone remembered it did.
  let surfaces = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "fleet-surfaces.json"), "utf8"));
    for (const r of j.results || []) if (r.id) surfaces[r.id] = r.client || null;
  } catch { surfaces = {}; }

  const donors = new Set(cleanDonorVerticals().map((d) => d.split("-")[0]));
  const scored = rows.map((row) => {
    const rec = row.record || {};
    const br = rec.build_ready || {};
    const req = br.mirror_request || {};
    const content = req.content || {};
    const surface = surfaces[row.id] || null;
    return {
      id: row.id,
      name: row.business_name,
      industry: String(row.industry || "").toLowerCase(),
      vertical: VERTICAL_OF[String(row.industry || "").toLowerCase()] || "",
      city: row.city, state: row.state,
      own: row.current_website || "",
      url: row.preview_url,
      status: row.status,
      hasContract: !!req.slug,
      services: (content.services || []).length,
      reviews: (content.reviews || []).length,
      photos: ((req.brand || {}).photos || []).length,
      pride: !!content.pride,
      surfaceMode: surface ? surface.mode : "",
      surfaceBasis: surface ? surface.basis : "",
      surface,
    };
  });

  const usable = scored.filter((s) => s.own && s.vertical && donors.has(s.vertical));
  const byVertical = new Map();
  for (const s of usable) {
    if (!byVertical.has(s.vertical)) byVertical.set(s.vertical, []);
    byVertical.get(s.vertical).push(s);
  }

  const spread = [];
  // 1. The dark-measured client first — the branch nothing else reaches.
  const dark = usable.find((s) => s.surfaceMode === "dark" && s.surfaceBasis === "paper");
  if (dark) spread.push({ ...dark, why: "client site MEASURED dark — exercises the dark branch" });

  // 2. Then the best-evidenced prospect in each remaining vertical.
  for (const [vertical, list] of byVertical) {
    if (spread.some((s) => s.vertical === vertical && s.id === (dark && dark.id))) continue;
    if (spread.some((s) => s.vertical === vertical)) continue;
    const best = [...list].sort((a, b) =>
      (b.hasContract - a.hasContract) || (b.services - a.services) || (b.reviews - a.reviews) || (b.photos - a.photos))[0];
    if (best) spread.push({ ...best, why: `best-evidenced ${vertical}: ${best.services} services, ${best.reviews} reviews, ${best.photos} photos` });
  }

  console.log(`fleet ${rows.length}  usable(own site + clean donor) ${usable.length}  verticals ${byVertical.size}`);
  for (const s of spread) {
    console.log(`\n${s.vertical.padEnd(11)} ${s.name}`);
    console.log(`            ${s.why}`);
    console.log(`            contract=${s.hasContract} services=${s.services} reviews=${s.reviews} photos=${s.photos} pride=${s.pride} surface=${s.surfaceMode || "unmeasured"}/${s.surfaceBasis || "-"}`);
    console.log(`            own  ${s.own}`);
    console.log(`            ours ${s.url}`);
  }

  const out = arg("out", "");
  if (out) {
    const p = path.isAbsolute(out) ? out : path.join(ROOT, out);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(spread, null, 1));
    console.log(`\nwrote ${p}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
