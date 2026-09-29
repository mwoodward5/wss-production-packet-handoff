"use strict";
/**
 * scripts/varied-markets-repick.js — pick TEN from the candidates that have
 * been PROVEN to clear the service floor, not merely believed to.
 *
 * WHY THIS EXISTS. The first spread was picked on liveness, logo, donor, trade
 * and photographs — every gate the lane applies except the one that actually
 * refused it. Three builds in a row came back
 * `revealable:false / service_floor:no_services_resolved`, at 70-84s each, and
 * a screen of all 95 live candidates (scripts/service-floor-prescreen.js) then
 * measured the real shape of the fleet:
 *
 *     clears on the homepage alone (what the lane reads today)  25/95
 *     clears with one hop down the client's own service links   40/95
 *     fencing                                                    0
 *     tattoo                                                     0
 *
 * Fencing and tattoo prospects publish no harvestable service list ANYWHERE on
 * their sites, so no amount of picking reaches them: the honest trade spread
 * this fleet supports is hvac + plumbing, and saying so is the finding. This
 * script therefore picks from the 25 proven candidates and reports the loss
 * rather than quietly shipping ten plumbers and calling it a spread.
 *
 *   node scripts/varied-markets-repick.js --out artifacts/varied-markets-2.json
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const WANT = Number(arg("want", "10")) || 10;
const MIN_KM = Number(arg("minkm", "100")) || 100;

function kmBetween(a, b) {
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return null;
  const R = 6371; const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function separated(c, picked) {
  for (const p of picked) {
    const km = kmBetween(c, p);
    if (km === null) { if (c.metro === p.metro) return false; continue; }
    if (km < MIN_KM) return false;
  }
  return true;
}

function main() {
  const cands = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "varied-markets.json"), "utf8")).allLive || [];
  const screen = JSON.parse(fs.readFileSync(path.join(ROOT, "artifacts", "service-prescreen-all.json"), "utf8"));
  const byId = new Map(cands.map((c) => [c.id, c]));

  const proven = screen
    .filter((s) => s.clearsToday)
    .map((s) => {
      const c = byId.get(s.id) || {};
      return { ...c, harvested: s.homeOnly, sample: s.sample, clearsWithHopOnly: false };
    })
    .filter((c) => c.id);

  // Evidence order: a real photo bank first (the hero wash needs something to
  // show), then hero-grade pictures, then the length of the proven service list.
  const score = (s) => (s.hero * 1000) + (s.photos * 50) + ((s.harvested || 0) * 30) + Math.min(200, s.reviews || 0);
  const ranked = [...proven].sort((a, b) => score(b) - score(a));

  const byTrade = new Map();
  for (const c of ranked) {
    if (!byTrade.has(c.trade)) byTrade.set(c.trade, []);
    byTrade.get(c.trade).push(c);
  }
  console.log(`proven candidates: ${proven.length}  trades: ${[...byTrade.entries()].map(([t, l]) => `${t}=${l.length}`).join("  ")}`);

  // Breadth, then balance — the same two passes as the first picker, over a
  // pool that has been proven rather than assumed.
  const pick = [];
  for (const [, list] of [...byTrade.entries()].sort((a, b) => a[1].length - b[1].length)) {
    if (pick.length >= WANT) break;
    const next = list.find((c) => separated(c, pick));
    if (next) pick.push(next);
  }
  while (pick.length < WANT) {
    const taken = {};
    for (const p of pick) taken[p.trade] = (taken[p.trade] || 0) + 1;
    let best = null;
    for (const [trade, list] of byTrade) {
      const cand = list.find((c) => !pick.includes(c) && separated(c, pick));
      if (!cand) continue;
      const held = taken[trade] || 0;
      if (!best || held < best.held || (held === best.held && score(cand) > score(best.cand))) best = { cand, held };
    }
    if (!best) break;
    pick.push(best.cand);
  }

  console.log(`\n=== PICKED ${pick.length} ===`);
  for (const p of pick) {
    console.log(`${p.trade.padEnd(9)} ${String(p.name).slice(0, 38).padEnd(40)} ${p.city}, ${p.state}`);
    console.log(`${" ".repeat(9)} donor=${p.donor} photos=${p.photos} (hero ${p.hero}) services PROVEN=${p.harvested}`);
    console.log(`${" ".repeat(9)} svc: ${(p.sample || []).slice(0, 5).join(" / ").slice(0, 110)}`);
    console.log(`${" ".repeat(9)} own  ${p.own}`);
  }
  const counts = {};
  for (const p of pick) counts[p.trade] = (counts[p.trade] || 0) + 1;
  console.log(`\ntrades: ${JSON.stringify(counts)}`);
  console.log(`with a photo bank: ${pick.filter((p) => p.photos > 0).length}/${pick.length}`);
  let closest = { km: Infinity };
  for (let i = 0; i < pick.length; i++) for (let j = i + 1; j < pick.length; j++) {
    const km = kmBetween(pick[i], pick[j]);
    if (km !== null && km < closest.km) closest = { km, a: pick[i], b: pick[j] };
  }
  console.log(`closest pair: ${closest.a ? `${closest.a.city}, ${closest.a.state} <-> ${closest.b.city}, ${closest.b.state} = ${closest.km.toFixed(0)}km` : "n/a"}`);

  const bench = ranked.filter((c) => !pick.includes(c));
  const o = arg("out", "");
  if (o) {
    const f = path.isAbsolute(o) ? o : path.join(ROOT, o);
    fs.writeFileSync(f, JSON.stringify({ picked: pick, bench }, null, 1));
    console.log(`\nbench (proven, unused): ${bench.length}`);
    console.log(`wrote ${f}`);
  }
}

main();
