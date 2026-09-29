"use strict";
// scripts/rebuild-with-photos.js — rebuild a named list of stored prospects
// through the REAL lane and print, per build, exactly what happened to their
// photographs: how many the bank held, how many the request carried, how many
// the engine could place, and how many it had nowhere to put.
//
// The last number is the one worth reading. The harvest is no longer the
// constraint — the donor's declared photo_slots are.
//
//   node scripts/rebuild-with-photos.js --list scripts/rebuild-photo-batch.json
//   node scripts/rebuild-with-photos.js --name "M & M Heating"

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");
const { select } = require("../lib/store");
const { inferTrade } = require("../lib/trade-inference");

const arg = (n, d = "") => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] || "true") : d;
};

async function findRow(name) {
  const res = await select(
    "ghost_agency_prospects",
    `select=*&business_name=ilike.*${encodeURIComponent(name)}*&limit=1`,
  );
  if (!res.ok || !res.data.length) return null;
  return res.data[0];
}

function prospectFrom(row) {
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  // THE LOGO IS ON THE RECORD, JUST NOT WHERE THE OLD REBUILD SCRIPT LOOKED.
  // scripts/rebuild-prospect.js reads brand.logo off build_ready.mirror_request
  // — and for M & M that contract is a stub with an empty brand block, so the
  // rebuild died at `no_verified_logo` for a business whose mark is sitting in
  // record.leadminer_mirror_ready.logo_url. Same class of fault as the photos:
  // the data was there, the reader was pointed at the wrong field.
  const lmr = record.leadminer_mirror_ready || {};
  const colors = lmr.brand_colors || {};
  // THE LABEL IS A HINT; THE SERVICES ARE THE EVIDENCE — and this script learnt
  // that the expensive way. `record.industry` for M & M Heating & Cooling is
  // the literal string "plumbing", while all ten of their services are air
  // conditioners, furnaces, boilers and mini-splits. Handing that label to the
  // resolver lane published an HVAC company as a plumber, live, titled
  // "M & M Heating & Cooling, LLC — Plumbing in Stratford, CT". The packet lane
  // has always inferred the trade from services (lib/mirror-lane-build.js,
  // leadMinerMirrorInput) — this is the same call with the same inputs, so a
  // rebuild cannot disagree with the build it is replacing.
  const inferred = inferTrade({
    label: lmr.industry || record.industry || row.industry || "",
    services: lmr.services || row.primary_services || [],
    businessName: lmr.business_name || row.business_name || "",
  });
  return {
    _trade: inferred,
    ...row, record,
    business_name: f.business_name || row.business_name || lmr.business_name,
    industry: inferred.trade || f.industry || row.industry || lmr.industry,
    city: f.city || row.city || lmr.city,
    state: f.state || row.state || lmr.state,
    current_website: f.current_website || row.current_website || lmr.website_url,
    site: row.current_website || lmr.website_url || "",
    email: f.email || row.email,
    phone: f.phone || row.phone || lmr.phone_e164,
    place_id: f.place_id || record.place_id || lmr.place_id,
    rating: f.rating ?? record.rating ?? lmr.rating,
    review_count: f.review_count ?? record.review_count ?? lmr.review_count,
    marketing_city: f.service_area || record.service_area,
    logo_url: brand.logo || lmr.logo_url || "",
    logo_accent: brand.accent || colors.accent || colors.primary || "",
    logo_accent_source: brand.accent_source || lmr.logo_source_url || "",
  };
}

(async () => {
  const listPath = arg("list", "");
  const names = listPath
    ? JSON.parse(fs.readFileSync(path.isAbsolute(listPath) ? listPath : path.join(__dirname, "..", listPath), "utf8"))
    : [arg("name", "")].filter(Boolean);
  if (!names.length) { console.error("--list or --name required"); process.exit(2); }

  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const out = [];
  for (const entry of names) {
    const name = typeof entry === "string" ? entry : entry.name;
    const row = await findRow(name);
    if (!row) { console.log(`\n### ${name}\n  NO ROW`); out.push({ name, error: "no_row" }); continue; }
    const record = row.record || {};
    const bank = record.photo_bank || {};
    const bankPhotos = Array.isArray(bank.photos) ? bank.photos : [];
    console.log(`\n### ${row.business_name}`);
    console.log(`  bank: ${bankPhotos.length} photo(s), ${bankPhotos.filter((p) => p.grade === "hero").length} hero-grade, harvested ${bank.harvested_at || "?"}`);

    const prospect = prospectFrom(row);
    const trade = prospect._trade || {};
    console.log(`  trade: ${trade.trade || "?"} (label said "${record.industry || row.industry || "?"}") ${trade.multiTrade ? `MULTI-TRADE +${(trade.secondary || []).join("/")}` : ""}`);
    // A REBUILD MUST NEVER BE THE THING THAT BREAKS A LIVE SITE. A multi-trade
    // business has no honest single-trade mirror, and publishing one over a
    // working host would be a regression dressed as an improvement.
    if (trade.multiTrade) {
      console.log("  SKIPPED — multi-trade; a single-trade mirror would misrepresent them");
      out.push({ name: row.business_name, skipped: "multi_trade", secondary: trade.secondary });
      continue;
    }

    const t0 = Date.now();
    let built;
    try {
      built = await buildMirrorForProspect(prospect, {});
    } catch (e) {
      console.log(`  BUILD THREW: ${String(e.message || e).slice(0, 200)}`);
      out.push({ name: row.business_name, error: String(e.message || e).slice(0, 200) });
      continue;
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const checks = (built.checks || built.engine_checks || {});
    const photos = (checks.brand && checks.brand.photos) || (built.photos_report || {});
    const line = {
      name: row.business_name,
      host: String(built.preview_url || "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
      donor: built.donor || "",
      ok: built.ok, revealable: built.revealable, status: built.status, reason: built.reason || "",
      seconds: Number(secs),
      bank_photos: bankPhotos.length,
      bank_hero: bankPhotos.filter((p) => p.grade === "hero").length,
      supplied: photos.supplied ?? null,
      usable: photos.usable ?? null,
      placed: photos.placed ?? null,
      unplaced: photos.unplaced ?? null,
      transcoded: photos.transcoded ?? null,
    };
    console.log(`  built in ${secs}s — ok=${built.ok} revealable=${built.revealable} donor=${built.donor} ${built.reason ? `reason=${built.reason}` : ""}`);
    console.log(`  photos: supplied=${line.supplied} usable=${line.usable} PLACED=${line.placed} unplaced=${line.unplaced} transcoded=${line.transcoded}`);
    console.log(`  ${built.preview_url || "(no url)"}`);
    out.push(line);
  }

  const dest = path.join(__dirname, "..", "artifacts", "rebuild-with-photos.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${dest}`);
})().catch((e) => { console.error(e); process.exit(1); });
