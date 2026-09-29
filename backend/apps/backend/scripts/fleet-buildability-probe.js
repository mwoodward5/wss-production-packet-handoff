"use strict";
/**
 * scripts/fleet-buildability-probe.js — read-only. For every fleet row, answer
 * the questions the REAL lane will ask, BEFORE a build is spent on it:
 *
 *   - is its preview on the mirror lane (*.wss-ai.com) or the dead /try/ lane?
 *   - does it carry a logo the lane will accept (https, not a third-party mark)?
 *   - what trade does its OWN SERVICE LIST say it is, vs its label?
 *   - is it multi-trade (an automatic, correct refusal)?
 *   - how many of its own photographs are banked?
 *
 * Every one of these is a refusal the lane makes for free. Asking here means a
 * ten-site spread is picked from rows that can actually be built, instead of
 * discovering four refusals after four deployments.
 */

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);

const { inferTrade } = require("../lib/trade-inference");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Every place a logo can be sitting, in the order the lane consults them. */
function logoOf(row) {
  const rec = row.record || {};
  const br = isObj(rec.build_ready) ? rec.build_ready : {};
  const req = isObj(br.mirror_request) ? br.mirror_request : {};
  const cands = [
    isObj(req.brand) ? req.brand.logo : "",
    isObj(br.brand) ? br.brand.logo : "",
    isObj(rec.brand) ? rec.brand.logo : "",
    rec.logo_url, rec.logo,
    isObj(rec.leadminer_mirror_ready) ? rec.leadminer_mirror_ready.logo_url : "",
    isObj(rec.truth_packet) && isObj(rec.truth_packet.mirror_ready) ? rec.truth_packet.mirror_ready.logo_url : "",
  ];
  for (const c of cands) if (typeof c === "string" && c.trim()) return c.trim();
  return "";
}

function servicesOf(row) {
  const rec = row.record || {};
  const br = isObj(rec.build_ready) ? rec.build_ready : {};
  const req = isObj(br.mirror_request) ? br.mirror_request : {};
  const lmr = isObj(rec.leadminer_mirror_ready) ? rec.leadminer_mirror_ready : {};
  const pools = [
    row.primary_services,
    isObj(req.content) ? req.content.services : null,
    lmr.services,
    isObj(rec.truth_packet) ? rec.truth_packet.services : null,
    isObj(br.content) ? br.content.services : null,
  ];
  const out = [];
  for (const p of pools) if (Array.isArray(p)) out.push(...p);
  return out;
}

const nameOfService = (s) => (typeof s === "string" ? s : (s && (s.name || s.title || s.label)) || "");

async function main() {
  const rows = await rest(
    `ghost_agency_prospects?select=*&preview_url=not.is.null&order=updated_at.desc&limit=600`,
  );
  const out = [];
  for (const row of rows) {
    const rec = row.record || {};
    const bank = isObj(rec.photo_bank) ? rec.photo_bank : {};
    const photos = Array.isArray(bank.photos) ? bank.photos.length : 0;
    const heroGrade = Array.isArray(bank.photos) ? bank.photos.filter((p) => p && p.grade === "hero").length : 0;
    const services = servicesOf(row).map(nameOfService).filter(Boolean);
    const logo = logoOf(row);
    const label = String(row.industry || rec.industry || "").toLowerCase().trim();
    let trade = { trade: "", multiTrade: false, secondary: [] };
    try {
      trade = inferTrade({ label, services, businessName: row.business_name || "" }) || trade;
    } catch (e) { trade = { trade: "", multiTrade: false, secondary: [], err: String(e.message || e) }; }
    const url = String(row.preview_url || "");
    out.push({
      id: row.id,
      name: row.business_name,
      label,
      trade: trade.trade || "",
      multiTrade: !!trade.multiTrade,
      secondary: trade.secondary || [],
      tradeMovedFromLabel: !!(trade.trade && label && trade.trade !== label),
      city: row.city || rec.city || "",
      state: row.state || rec.state || "",
      own: row.current_website || "",
      url,
      lane: /\.wss-ai\.com/i.test(url) ? "mirror" : (/\/try\//i.test(url) ? "try-dead" : "other"),
      status: row.status,
      site_slug: row.site_slug || "",
      photos, heroGrade,
      services: services.length,
      serviceSample: services.slice(0, 6),
      logo,
      logoHttps: /^https:\/\//i.test(logo),
      rating: rec.rating ?? null,
      reviews: (isObj(rec.build_ready) && isObj(rec.build_ready.demand)) ? rec.build_ready.demand.reviewCount : null,
    });
  }

  const mirror = out.filter((r) => r.lane === "mirror");
  console.log(`fleet rows with a preview_url: ${out.length}`);
  console.log(`  on the mirror lane (*.wss-ai.com): ${mirror.length}`);
  console.log(`  on the dead /try/ lane:            ${out.filter((r) => r.lane === "try-dead").length}`);
  console.log(`  elsewhere:                         ${out.filter((r) => r.lane === "other").length}`);
  console.log(`\nof the ${mirror.length} mirror-lane rows:`);
  console.log(`  with an https logo:        ${mirror.filter((r) => r.logoHttps).length}`);
  console.log(`  with a photo bank (>0):    ${mirror.filter((r) => r.photos > 0).length}`);
  console.log(`  with >=1 hero-grade photo: ${mirror.filter((r) => r.heroGrade > 0).length}`);
  console.log(`  with >=3 services:         ${mirror.filter((r) => r.services >= 3).length}`);
  console.log(`  multi-trade (auto-refuse): ${mirror.filter((r) => r.multiTrade).length}`);

  const byTrade = new Map();
  for (const r of mirror) {
    const k = r.trade || `(none:${r.label || "?"})`;
    byTrade.set(k, (byTrade.get(k) || 0) + 1);
  }
  console.log(`\ntrade by SERVICES (mirror lane):`);
  for (const [t, n] of [...byTrade.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(t).padEnd(16)} ${n}`);

  const moved = mirror.filter((r) => r.tradeMovedFromLabel && !r.multiTrade);
  console.log(`\nlabel DISAGREES with services on ${moved.length} mirror rows:`);
  for (const r of moved.slice(0, 25)) {
    console.log(`  ${String(r.name).slice(0, 38).padEnd(40)} label=${String(r.label).padEnd(12)} services say ${r.trade}   [${r.serviceSample.slice(0, 3).join(" / ").slice(0, 70)}]`);
  }

  const o = arg("out", "");
  if (o) {
    const p = path.isAbsolute(o) ? o : path.join(ROOT, o);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(out, null, 1));
    console.log(`\nwrote ${p}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
