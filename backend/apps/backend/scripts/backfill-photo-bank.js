"use strict";
// scripts/backfill-photo-bank.js — bank the CLIENT'S OWN PHOTOGRAPHS for the
// whole live fleet, and report the coverage honestly, per host.
//
// WHY. The harvester works and always did; nothing ever wrote its output down.
// Measured 2026-08-11 across the whole store: 0 of 424 stored mirror contracts
// carry a single entry in brand.photos, and the field mirror-lane-build reads
// for Google Business media (record.photos) is written by nothing at all — 0 of
// 1333 rows. So every downstream reader of a contract has only ever seen one
// image per client: the logo.
//
// This walks every prospect that has a live mirror, builds the bank from their
// own website and their Google Business media, and writes it to
// record.photo_bank. From then on a rebuild reads photographs it already has,
// with a sha per picture, instead of re-crawling and hoping their site is up.
//
//   node scripts/backfill-photo-bank.js                 # every live mirror host
//   node scripts/backfill-photo-bank.js --limit 10      # first 10
//   node scripts/backfill-photo-bank.js --dry           # measure, write nothing
//   node scripts/backfill-photo-bank.js --host acme.wss-ai.com
//
// A business with no usable photography is a REAL ANSWER and is reported as
// such, per host, with the reason. It is not a failure and it is not silence.

const fs = require("node:fs");
const path = require("node:path");
const { select, upsertRow } = require("../lib/store");
const photoBank = require("../lib/client-photo-bank");

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function arg(name, fallback = "") {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] || "true") : fallback;
}
const DRY = process.argv.includes("--dry");
const LIMIT = Number(arg("limit", "0")) || 0;
const ONLY_HOST = arg("host", "");
const CONCURRENCY = Number(arg("concurrency", "4")) || 4;

/** Every prospect row, paged (PostgREST caps a page at 1000). */
async function allProspects() {
  const rows = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const res = await select(
      "ghost_agency_prospects",
      `select=id,prospect_id,business_name,status,current_website,record&order=id.asc&limit=1000&offset=${offset}`,
    );
    if (!res.ok) throw new Error(`select failed: ${JSON.stringify(res).slice(0, 300)}`);
    rows.push(...res.data);
    if (res.data.length < 1000) break;
  }
  return rows;
}

/** The mirror host on a record, if it has one. */
function mirrorHostOf(record) {
  const hits = JSON.stringify(record || {}).match(/https:\/\/([a-z0-9-]+)\.wss-ai\.com/gi) || [];
  for (const h of hits) {
    const host = h.replace(/^https:\/\//i, "");
    // OUR OWN HOSTS ARE NOT CLIENT MIRRORS. missioncontrol/console/gallery and
    // friends appear inside prospect records because the operator UI links to
    // them; harvesting "their photographs" would be harvesting our own.
    if (/^(rocketsites|callprep|missioncontrol|console|gallery|ledger|campaigns|line|hot|labs|status|www|app|dashboard|admin|api|connect|mail|proof|preview)\./i.test(host)) continue;
    return host;
  }
  return "";
}

function websiteOf(row) {
  const rec = isObj(row.record) ? row.record : {};
  const contract = isObj(rec.build_ready) && isObj(rec.build_ready.mirror_request)
    ? rec.build_ready.mirror_request : {};
  return String(
    row.current_website
    || rec.current_website
    || (isObj(contract.facts) ? contract.facts.current_website : "")
    || (isObj(rec.leadminer_mirror_ready) ? rec.leadminer_mirror_ready.website_url : "")
    || "",
  ).trim();
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

(async () => {
  const rows = await allProspects();
  let targets = rows
    .map((r) => ({ row: r, host: mirrorHostOf(r.record), website: websiteOf(r) }))
    .filter((t) => t.host);
  // One row per host: a host that appears on two rows is one mirror.
  const seen = new Set();
  targets = targets.filter((t) => (seen.has(t.host) ? false : (seen.add(t.host), true)));
  if (ONLY_HOST) targets = targets.filter((t) => t.host === ONLY_HOST);
  if (LIMIT) targets = targets.slice(0, LIMIT);

  process.stderr.write(`rows ${rows.length}; mirror hosts ${targets.length}; dry=${DRY}\n`);

  const results = await mapLimit(targets, CONCURRENCY, async (t, i) => {
    const rec = isObj(t.row.record) ? t.row.record : {};
    let bank;
    const t0 = Date.now();
    try {
      bank = await photoBank.buildPhotoBank({ website: t.website, record: rec });
    } catch (e) {
      bank = { version: photoBank.BANK_VERSION, photos: [], refused: [], counts: {}, verdict: "harvest_failed", note: String(e.message || e).slice(0, 200) };
    }
    const ms = Date.now() - t0;
    const line = {
      host: t.host,
      business: t.row.business_name || "",
      website: t.website,
      verdict: bank.verdict,
      kept: bank.photos.length,
      hero: (bank.photos || []).filter((p) => p.grade === "hero").length,
      own_site: (bank.photos || []).filter((p) => p.source === "own_site").length,
      gbp: (bank.photos || []).filter((p) => p.source === "gbp").length,
      refused: (bank.refused || []).length,
      gbp_media_calls: (bank.cost && bank.cost.gbp_media_calls) || 0,
      ms,
      note: bank.note,
    };
    if (!DRY) {
      const merged = { ...rec, photo_bank: bank };
      const saved = await upsertRow(
        "ghost_agency_prospects",
        { prospect_id: t.row.prospect_id, record: merged, updated_at: new Date().toISOString() },
        "prospect_id",
      );
      line.persisted = saved && saved.ok === false ? `failed:${JSON.stringify(saved.error || "").slice(0, 80)}` : (saved?.mode || "persisted");
    } else line.persisted = "dry";
    process.stderr.write(
      `${String(i + 1).padStart(3)}/${targets.length} ${line.host}  ${line.verdict}  kept=${line.kept} hero=${line.hero} `
      + `(site ${line.own_site} / gbp ${line.gbp})  ${ms}ms  ${line.persisted}\n`,
    );
    return line;
  });

  const live = results.filter((r) => r.verdict !== "not_attempted");
  const hist = results.reduce((a, r) => (a[r.kept] = (a[r.kept] || 0) + 1, a), {});
  const summary = {
    hosts: results.length,
    with_photography: results.filter((r) => r.kept > 0).length,
    with_hero_grade: results.filter((r) => r.hero > 0).length,
    no_usable_photography: results.filter((r) => r.verdict === "no_usable_photography").length,
    not_attempted: results.filter((r) => r.verdict === "not_attempted").length,
    harvest_failed: results.filter((r) => r.verdict === "harvest_failed").length,
    mean_photos: (results.reduce((a, r) => a + r.kept, 0) / (results.length || 1)).toFixed(2),
    photos_per_host: hist,
    total_photos: results.reduce((a, r) => a + r.kept, 0),
    billed_places_media_calls: results.reduce((a, r) => a + r.gbp_media_calls, 0),
    median_ms: live.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(live.length / 2)] || 0,
  };
  const out = path.join(__dirname, "..", "artifacts", "photo-bank-backfill.json");
  try {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
  } catch { /* the numbers still print */ }
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nPER HOST — the ones with no usable photography of their own:");
  for (const r of results.filter((x) => x.kept === 0)) {
    console.log(`  ${r.host}\n     ${r.business} · ${r.website || "no website"}\n     ${r.note}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
