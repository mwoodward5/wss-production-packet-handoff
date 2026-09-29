"use strict";
/**
 * scripts/varied-markets-pick.js — pick TEN prospects from the fleet that sit in
 * TEN DIFFERENT metro areas, across as many trades as the clean donor library
 * actually owns, preferring the ones carrying a real photo bank, and never
 * picking a host whose preview is dead or whose row the lane will refuse.
 *
 * WHY EVERY GATE IS ASKED HERE. Each of these is a refusal the real lane makes
 * for free, and each one discovered AFTER selection turns "ten sites" into six
 * sites and four excuses:
 *
 *   lane            — 29 fleet rows still point at the dead /try/ host
 *   donor           — med spa is retired for outreach; electrical has no donor
 *   multi-trade     — a single-trade mirror for a two-trade shop is a half-truth
 *   https logo      — the palette comes from the mark; no mark, nothing honest
 *   third-party mark— a manufacturer badge is not the client's identity
 *   liveness        — measured, because half of an earlier sample answered 404
 *
 * The trade a row is filed under is the trade its OWN SERVICES prove, never its
 * label: the fleet has an HVAC company labelled "plumbing" and it was published
 * as a plumber once already.
 *
 * TWO THINGS THIS SCRIPT GOT WRONG FIRST, both recorded because both are easy
 * to make again:
 *
 * 1. A METRO IS NOT A CITY STRING. Catoosa, Broken Arrow and Tulsa are three
 *    different values of `city` and one market — a prospect in each would be
 *    three neighbours comparing near-identical sites, which is the exact risk
 *    the spread exists to manage. Separation is measured in kilometres from the
 *    stored coordinates instead (MIN_KM), and only falls back to the city
 *    string when a row has no coordinates.
 *
 * 2. BREADTH BEFORE DEPTH, OR SCARCE TRADES DIE. Reducing to one row per metro
 *    BEFORE choosing trades silently deleted both tattoo studios: each shares a
 *    town with a plumber carrying more photographs, so the plumber won the
 *    metro and the trade vanished from the pool. Trades are therefore filled
 *    rarest-first from the FULL candidate list, with distance applied at the
 *    moment of picking.
 *
 *   node scripts/varied-markets-pick.js --out artifacts/varied-markets.json
 */

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const WANT = Number(arg("want", "10")) || 10;
// 100km separates Tulsa from Catoosa (28km) and Broken Arrow (24km) while
// leaving any two genuinely different markets comfortably apart.
const MIN_KM = Number(arg("minkm", "100")) || 100;

/** Great-circle km. Two rows with no coordinates fall back to the city string. */
function kmBetween(a, b) {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)
    || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Far enough from everything already picked to count as a different market. */
function separated(cand, picked) {
  for (const p of picked) {
    const km = kmBetween(cand, p);
    if (km === null) { if (cand.metro === p.metro) return { ok: false, near: p, km: null }; continue; }
    if (km < MIN_KM) return { ok: false, near: p, km };
  }
  return { ok: true };
}

const { inferTrade } = require("../lib/trade-inference");
const { resolveBuildableDonor } = require("../lib/lead-miner");
const { isThirdPartyMark } = require("../lib/capture-brand");

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text(); try { return JSON.parse(t); } catch { return []; }
}

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const nameOfService = (s) => (typeof s === "string" ? s : (s && (s.name || s.title || s.label)) || "");

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
  ];
  for (const c of cands) if (typeof c === "string" && c.trim()) return c.trim();
  return "";
}

function servicesOf(row) {
  const rec = row.record || {};
  const br = isObj(rec.build_ready) ? rec.build_ready : {};
  const req = isObj(br.mirror_request) ? br.mirror_request : {};
  const lmr = isObj(rec.leadminer_mirror_ready) ? rec.leadminer_mirror_ready : {};
  const pools = [row.primary_services, isObj(req.content) ? req.content.services : null, lmr.services,
    isObj(rec.truth_packet) ? rec.truth_packet.services : null, isObj(br.content) ? br.content.services : null];
  const out = [];
  for (const p of pools) if (Array.isArray(p)) out.push(...p);
  return out.map(nameOfService).filter(Boolean);
}

async function alive(url) {
  if (!url) return { ok: false, status: 0 };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow" });
    const body = r.ok ? await r.text() : "";
    return { ok: r.ok && body.length > 500, status: r.status, bytes: body.length };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e).slice(0, 60) };
  } finally { clearTimeout(t); }
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function main() {
  const rows = await rest(`ghost_agency_prospects?select=*&preview_url=not.is.null&order=updated_at.desc&limit=600`);
  const rejected = {};
  const bump = (k) => { rejected[k] = (rejected[k] || 0) + 1; };

  const usable = [];
  for (const row of rows) {
    const rec = row.record || {};
    const url = String(row.preview_url || "");
    if (!/\.wss-ai\.com/i.test(url)) { bump("not_on_mirror_lane"); continue; }

    const city = String(row.city || rec.city || "").trim();
    const state = String(row.state || rec.state || "").trim();
    if (!city || !state) { bump("no_metro"); continue; }
    if (!row.current_website) { bump("no_own_site"); continue; }

    const services = servicesOf(row);
    const label = String(row.industry || rec.industry || "").toLowerCase().trim();
    const t = inferTrade({ label, services, businessName: row.business_name || "" }) || {};
    if (t.multiTrade) { bump("multi_trade"); continue; }
    const trade = String(t.trade || label || "").toLowerCase().trim();
    const donor = resolveBuildableDonor(trade);
    if (!donor || !donor.ok) { bump(`donor:${(donor && donor.reason) || "none"}`); continue; }

    const logo = logoOf(row);
    if (!/^https:\/\//i.test(logo)) { bump(logo ? "logo_not_https" : "no_logo"); continue; }
    if (isThirdPartyMark(logo.replace(/^https?:\/\//i, ""))) { bump("logo_third_party_mark"); continue; }

    const bank = isObj(rec.photo_bank) ? rec.photo_bank : {};
    const photos = Array.isArray(bank.photos) ? bank.photos.length : 0;
    const hero = Array.isArray(bank.photos) ? bank.photos.filter((p) => p && p.grade === "hero").length : 0;

    usable.push({
      id: row.id, name: row.business_name, city, state,
      metro: `${city.toLowerCase()}, ${state.toLowerCase()}`,
      label, trade, donor: donor.donor,
      tradeMovedFromLabel: !!(t.trade && label && t.trade !== label),
      own: row.current_website, url, status: row.status, site_slug: row.site_slug || "",
      photos, hero, services: services.length, serviceSample: services.slice(0, 5),
      logo, rating: rec.rating ?? null,
      lat: Number(rec.latitude), lon: Number(rec.longitude),
      reviews: (isObj(rec.build_ready) && isObj(rec.build_ready.demand)) ? rec.build_ready.demand.reviewCount : 0,
    });
  }

  process.stderr.write(`fleet ${rows.length} -> buildable-looking ${usable.length}\n`);
  for (const [k, n] of Object.entries(rejected).sort((a, b) => b[1] - a[1])) process.stderr.write(`  rejected ${String(k).padEnd(28)} ${n}\n`);

  // Liveness on EVERY candidate, not on one head per town: the scarce trades
  // live in towns a plumber would otherwise win, and a trade that is never
  // measured cannot be picked.
  const score = (s) => (s.hero * 1000) + (s.photos * 50) + (s.services * 25) + Math.min(200, s.reviews || 0);
  const ranked = [...usable].sort((a, b) => score(b) - score(a));
  const checked = await mapLimit(ranked, 8, async (c, i) => {
    const a = await alive(c.url);
    process.stderr.write(
      `${String(i + 1).padStart(3)}/${ranked.length} ${c.trade.padEnd(11)} ${String(c.name).slice(0, 32).padEnd(34)} ${String(c.metro).padEnd(24)} `
      + `ph=${String(c.photos).padStart(2)} hero=${String(c.hero).padStart(2)} svc=${String(c.services).padStart(2)} ${a.ok ? "LIVE" : `DEAD ${a.status}`}\n`,
    );
    return { ...c, live: a.ok, http: a.status };
  });

  const live = checked.filter((c) => c.live).sort((a, b) => score(b) - score(a));
  process.stderr.write(`\nlive ${live.length}/${checked.length}\n`);

  const byTrade = new Map();
  for (const c of live) {
    if (!byTrade.has(c.trade)) byTrade.set(c.trade, []);
    byTrade.get(c.trade).push(c);
  }
  process.stderr.write(`trades available live: ${[...byTrade.entries()].sort((a, b) => b[1].length - a[1].length).map(([t, l]) => `${t}=${l.length}`).join("  ")}\n`);

  // BREADTH FIRST — one per trade, rarest trade first, so a vertical with two
  // candidates is not crowded out by the forty-seven plumbers.
  const pick = [];
  const tradesByScarcity = [...byTrade.entries()].sort((a, b) => a[1].length - b[1].length);
  for (const [, list] of tradesByScarcity) {
    if (pick.length >= WANT) break;
    const next = list.find((c) => separated(c, pick).ok);
    if (next) pick.push(next);
  }

  // THEN BALANCE, NOT EVIDENCE. Filling the remaining slots by score alone
  // refilled seven of ten with plumbers, because plumbing is both the biggest
  // pool and the best photographed. Each further slot therefore goes to the
  // trade holding the FEWEST picks so far, and only within that tie is the
  // best-evidenced candidate chosen — which is a round-robin that still prefers
  // a real photo bank wherever the trade has one. Distance is enforced in both
  // passes, at the moment of picking.
  while (pick.length < WANT) {
    const taken = {};
    for (const p of pick) taken[p.trade] = (taken[p.trade] || 0) + 1;
    let best = null;
    for (const [trade, list] of byTrade) {
      const cand = list.find((c) => !pick.includes(c) && separated(c, pick).ok);
      if (!cand) continue;
      const held = taken[trade] || 0;
      if (!best || held < best.held || (held === best.held && score(cand) > score(best.cand))) {
        best = { cand, held };
      }
    }
    if (!best) break;
    pick.push(best.cand);
  }

  console.log(`\n=== PICKED ${pick.length} ===`);
  for (const p of pick) {
    console.log(`${p.trade.padEnd(11)} ${String(p.name).slice(0, 40).padEnd(42)} ${p.city}, ${p.state}`);
    console.log(`${" ".repeat(11)} donor=${p.donor} photos=${p.photos} (hero ${p.hero}) services=${p.services} reviews=${p.reviews}${p.tradeMovedFromLabel ? `  [label said "${p.label}" — services say ${p.trade}]` : ""}`);
    console.log(`${" ".repeat(11)} own  ${p.own}`);
    console.log(`${" ".repeat(11)} ours ${p.url}`);
  }
  const counts = {};
  for (const p of pick) counts[p.trade] = (counts[p.trade] || 0) + 1;
  console.log(`\ntrades: ${JSON.stringify(counts)}`);
  console.log(`with a photo bank: ${pick.filter((p) => p.photos > 0).length}/${pick.length}`);

  // Print the CLOSEST pair, because "ten distinct cities" is the claim that was
  // wrong last time and a single number proves or disproves it.
  let closest = { km: Infinity, a: null, b: null };
  for (let i = 0; i < pick.length; i++) {
    for (let j = i + 1; j < pick.length; j++) {
      const km = kmBetween(pick[i], pick[j]);
      if (km !== null && km < closest.km) closest = { km, a: pick[i], b: pick[j] };
    }
  }
  console.log(`closest pair: ${closest.a ? `${closest.a.city}, ${closest.a.state} <-> ${closest.b.city}, ${closest.b.state} = ${closest.km.toFixed(0)}km (floor ${MIN_KM}km)` : "n/a"}`);
  const noCoords = pick.filter((p) => !Number.isFinite(p.lat));
  if (noCoords.length) console.log(`WITHOUT COORDINATES (separated by city string only): ${noCoords.map((p) => p.name).join(", ")}`);

  const o = arg("out", "");
  if (o) {
    const p = path.isAbsolute(o) ? o : path.join(ROOT, o);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // The bench matters: a pick that fails verification is REPLACED, and the
    // replacement has to be a live, gate-clean row in a town we have not used.
    fs.writeFileSync(p, JSON.stringify({
      picked: pick,
      bench: live.filter((c) => !pick.includes(c)),
      allLive: live,
    }, null, 1));
    console.log(`\nwrote ${p}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
