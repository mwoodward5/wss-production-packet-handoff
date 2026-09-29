"use strict";
/**
 * scripts/service-floor-prescreen.js — will this prospect clear the service
 * floor, asked over plain HTTP before a build is spent finding out?
 *
 * WHY. Two of the first two rebuilds in a ten-site spread came back
 * `revealable:false / service_floor:no_services_resolved` after 84s and 70s of
 * real build each. That refusal is correct — a mirror with no services is a
 * donor template wearing a logo — but it is knowable for the price of two GETs,
 * because the thing the lane looks for is on the client's own page:
 *
 *   schema_offer  — hasOfferCatalog / makesOffer / Service nodes in ld+json
 *   page_heading  — headings inside the page's own services section
 *
 * This screen runs the ENGINE'S OWN harvester (lib/mirror-engine/service-harvest)
 * against the client's homepage and their services page, so a PASS here means
 * the same code that will run during the build already found the same names.
 * It is deliberately not a re-implementation: a screen that disagrees with the
 * gate it is screening for is worse than no screen.
 *
 * It is a SCREEN, not a promise. The build also applies service-names.js
 * refusals and the contract merge, so a thin PASS can still be refused. It can
 * only ever rule candidates OUT cheaply, which is all that is being asked of it.
 *
 *   node scripts/service-floor-prescreen.js --list artifacts/varied-markets.json --out artifacts/service-prescreen.json
 */

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const FLOOR = Number(arg("floor", "3")) || 3;

const { harvestPageServices } = require("../lib/mirror-engine/service-harvest");

async function get(url) {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; wss-prescreen/1.0)" },
    });
    if (!r.ok) return { status: r.status, html: "" };
    return { status: r.status, html: await r.text() };
  } catch (e) { return { status: 0, error: String(e.message || e).slice(0, 70), html: "" }; }
}

/** Every ld+json node on the page, flattened through @graph. */
function ldNodesOf(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let j;
    try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const push = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(push); return; }
      out.push(n);
      if (Array.isArray(n["@graph"])) n["@graph"].forEach(push);
    };
    push(j);
  }
  return out;
}

/**
 * THE CLIENT'S OWN SERVICE PAGES, named by the client's own navigation.
 *
 * This is the measurement that matters. Titanium HVAC's homepage carries one
 * ld+json Place node, five headings of marketing copy ("Focus on making
 * memories."), and a menu reading About / Blog / Residential / Commercial —
 * nothing a service harvester may honestly keep. Their actual service list is
 * one click away, at /omaha-residential-hvac-services/, and the engine never
 * goes there because it reads the homepage and stops.
 *
 * So the screen reports TWO numbers per candidate: what the homepage alone
 * yields (what the lane gets today) and what the homepage plus one hop down the
 * client's own service links yields. The gap between them is the size of the
 * engine's blind spot, measured rather than argued.
 */
const SERVICE_LINK = /service|repair|install|maintenance|residential|commercial|what-we-do|our-work|solutions/i;
const NOT_A_PAGE = /\.(jpg|jpeg|png|gif|svg|pdf|zip|mp4|webp)$|^mailto:|^tel:|^javascript:|#/i;

function sameOriginServiceLinks(html, baseUrl, max = 4) {
  let base; try { base = new URL(baseUrl); } catch { return []; }
  const out = []; const seen = new Set();
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < max) {
    const href = m[1];
    if (NOT_A_PAGE.test(href)) continue;
    let u; try { u = new URL(href, base); } catch { continue; }
    if (u.host !== base.host) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // The PATH is the evidence, not just the anchor text: "Residential" is a
    // useless label but /omaha-residential-hvac-services/ names the page.
    if (!SERVICE_LINK.test(u.pathname) && !SERVICE_LINK.test(text)) continue;
    const key = u.href.replace(/#.*$/, "");
    if (seen.has(key) || key.replace(/\/$/, "") === base.href.replace(/\/$/, "")) continue;
    seen.add(key); out.push(key);
  }
  return out;
}

async function harvestInto(found, url, perPage) {
  const r = await get(url);
  if (!r.html) { perPage.push({ url, status: r.status, error: r.error || "", n: 0 }); return ""; }
  let h = { services: [] };
  try { h = harvestPageServices({ html: r.html, ldNodes: ldNodesOf(r.html), max: 24 }) || { services: [] }; } catch { /* screen only */ }
  for (const s of h.services || []) if (s && s.name && !found.has(s.name.toLowerCase())) found.set(s.name.toLowerCase(), s);
  perPage.push({ url, status: r.status, n: (h.services || []).length, sources: [...new Set((h.services || []).map((s) => s.source))] });
  return r.html;
}

async function screen(row) {
  const site = row.own || row.current_website || "";
  const found = new Map();
  const perPage = [];

  // 1. The homepage — exactly what the lane reads today.
  const homeHtml = await harvestInto(found, site, perPage);
  const homeOnly = found.size;

  // 2. One hop down the client's own service links.
  const hops = homeHtml ? sameOriginServiceLinks(homeHtml, site, 4) : [];
  for (const u of hops) {
    if (found.size >= FLOOR + 4) break;
    await harvestInto(found, u, perPage);
  }

  const services = [...found.values()];
  return {
    id: row.id, name: row.name, trade: row.trade, city: row.city, state: row.state,
    own: site, url: row.url, photos: row.photos, hero: row.hero,
    homeOnly, harvested: services.length,
    clearsToday: homeOnly >= FLOOR,
    clearsWithHop: services.length >= FLOOR,
    hops,
    sources: [...new Set(services.map((s) => s.source))],
    sample: services.slice(0, 8).map((s) => s.name),
    perPage,
  };
}

async function mapLimit(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, limit) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

async function main() {
  const listPath = arg("list", "artifacts/varied-markets.json");
  const p = path.isAbsolute(listPath) ? listPath : path.join(ROOT, listPath);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const which = arg("which", "allLive");
  const rows = Array.isArray(j) ? j : (j[which] || j.picked || []);
  process.stderr.write(`screening ${rows.length} candidate(s) against a floor of ${FLOOR}\n`);

  const res = await mapLimit(rows, 6, async (r, i) => {
    const out = await screen(r);
    process.stderr.write(
      `${String(i + 1).padStart(3)}/${rows.length} ${String(out.trade).padEnd(10)} ${String(out.name).slice(0, 30).padEnd(32)} `
      + `home=${String(out.homeOnly).padStart(2)} +hop=${String(out.harvested).padStart(2)} `
      + `${out.clearsToday ? "CLEARS" : (out.clearsWithHop ? "HOP   " : " thin ")} ${out.sample.slice(0, 3).join(" / ").slice(0, 56)}\n`,
    );
    return out;
  });

  const today = res.filter((r) => r.clearsToday);
  const withHop = res.filter((r) => r.clearsWithHop);
  console.log(`\n=== floor ${FLOOR} ===`);
  console.log(`clears on the homepage alone (what the lane reads today): ${today.length}/${res.length}`);
  console.log(`clears with ONE HOP down the client's own service links  : ${withHop.length}/${res.length}`);
  const bt = (list) => { const o = {}; for (const r of list) o[r.trade] = (o[r.trade] || 0) + 1; return JSON.stringify(o); };
  console.log(`  today by trade  : ${bt(today)}`);
  console.log(`  with hop by trade: ${bt(withHop)}`);

  const o = arg("out", "");
  if (o) {
    const f = path.isAbsolute(o) ? o : path.join(ROOT, o);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(res, null, 1));
    console.log(`wrote ${f}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
