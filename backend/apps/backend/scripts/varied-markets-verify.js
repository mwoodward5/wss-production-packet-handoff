"use strict";
/**
 * scripts/varied-markets-verify.js — render each rebuilt mirror in a real
 * browser at 1280 and 390 and answer, from the DOM, the questions a passing
 * gate cannot answer:
 *
 *   TRADE      does the page call them what they are?
 *   SURFACE    is it a light page, measured from the painted background?
 *   ACCENT     is the colour on the page the accent measured from THEIR logo?
 *   LOGO       is anything painted over their mark? (elementFromPoint x3)
 *   CTA        is their primary call-to-action covered?
 *   SERVICES   are these real services, or nav labels wearing a service's hat?
 *   IDENTITY   distinct <title> and <h1>, both carrying the name and the town
 *   HERO       is the hero picture theirs, proven by bytes, or donor stock?
 *
 * WHY BYTES FOR THE HERO. The engine OVERWRITES the donor's image file at the
 * donor's own photo slot, so the served URL is identical whether the picture is
 * the client's or the donor's stock. Only the bytes can tell them apart, and we
 * ship the donor in this repo, so the original is on disk:
 *
 *   sha256(served) === sha256(donors-clean/<donor>/<slot>)  -> donor stock
 *   sha256 differs                                          -> theirs
 *
 * This file deliberately does NOT import the engine's predicates. It is the
 * second opinion; borrowing the first opinion's allowlists would make it an
 * echo. (scripts/mailable-scan.js keeps the same contract and is run alongside.)
 *
 *   node scripts/varied-markets-verify.js --list artifacts/varied-markets-run.json
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const OUT = arg("out", "artifacts/varied-markets-verify.json");
const SHOTDIR = path.join(ROOT, arg("shots", "artifacts/varied-markets-shots"));

const sha = (b) => createHash("sha256").update(b).digest("hex");

/** Nav items and section labels that are NOT services — owned by this file. */
const NOT_A_SERVICE = [
  "photo gallery", "gallery", "comfort club", "about us", "about", "contact us", "contact",
  "home", "services", "our services", "reviews", "testimonials", "blog", "careers",
  "financing", "specials", "coupons", "promotions", "book now", "schedule", "request service",
  "get a quote", "free estimate", "membership", "maintenance plan", "service area",
  "service areas", "faq", "faqs", "our work", "projects", "portfolio", "team", "our team",
  "privacy policy", "terms", "sitemap", "news", "resources", "why choose us", "meet the team",
];

function luminance(rgb) {
  const m = String(rgb).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b, a] = m[1].split(",").map((s) => Number(s.trim()));
  if (a === 0) return null;
  const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const hexOf = (rgb) => {
  const m = String(rgb).match(/rgba?\(([^)]+)\)/);
  if (!m) return "";
  const [r, g, b] = m[1].split(",").map((s) => Number(s.trim()));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
};

/** Perceptual-ish distance so "close enough to their accent" is a number. */
function colourDist(a, b) {
  const p = (h) => { const s = String(h).replace("#", ""); return s.length === 6 ? [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) : null; };
  const x = p(a); const y = p(b);
  if (!x || !y) return null;
  return Math.sqrt(x.reduce((acc, v, i) => acc + (v - y[i]) ** 2, 0));
}

function donorSlots(donorName) {
  const mp = path.join(ROOT, "donors-clean", donorName, "BOILERPLATE.json");
  if (!fs.existsSync(mp)) return [];
  let m; try { m = JSON.parse(fs.readFileSync(mp, "utf8")); } catch { return []; }
  return (m.photo_slots || []).map((rel) => {
    const p = path.join(ROOT, "donors-clean", donorName, rel);
    return { rel, sha: fs.existsSync(p) ? sha(fs.readFileSync(p)) : "" };
  });
}

/** Everything the page can tell us, gathered in one evaluate per viewport. */
const PAGE_PROBE = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05; };
  const txt = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();

  // --- surface: the background actually painted behind the top of the page
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor;
  let paintedBg = bodyBg;
  const probe = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight * 0.75));
  let chain = [];
  for (let el = probe; el; el = el.parentElement) {
    const bg = getComputedStyle(el).backgroundColor;
    chain.push({ tag: el.tagName, cls: String(el.className || "").slice(0, 40), bg });
    if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) { paintedBg = bg; break; }
  }

  // --- identity
  const h1s = [...document.querySelectorAll("h1")].filter(vis).map(txt).filter(Boolean);

  // --- the client's mark: the header image most likely to BE the logo
  const header = document.querySelector("header") || document.body;
  const imgs = [...header.querySelectorAll("img")].filter(vis);
  let logo = null;
  for (const im of imgs) {
    const r = im.getBoundingClientRect();
    if (r.top > 220) continue;
    const hint = ((im.alt || "") + " " + (im.src || "") + " " + (im.className || "")).toLowerCase();
    const score = (/logo|mark|brand/.test(hint) ? 100 : 0) + (r.width * r.height) / 1000 - r.top;
    if (!logo || score > logo.score) logo = { el: im, score, r };
  }
  let logoProbe = null;
  if (logo) {
    const r = logo.r;
    const ys = Math.round(r.top + r.height / 2);
    const pts = [Math.round(r.left + r.width * 0.2), Math.round(r.left + r.width * 0.5), Math.round(r.left + r.width * 0.8)];
    logoProbe = {
      rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      src: logo.el.src, alt: logo.el.alt || "",
      hits: pts.map((x) => {
        const el = document.elementFromPoint(x, ys);
        if (!el) return "(none)";
        if (el === logo.el) return "logo";
        if (el.closest && el.closest("#wss-floater")) return "FLOATER:" + (el.id || el.className || el.tagName);
        return (el.tagName + (el.id ? "#" + el.id : "") + (el.className ? "." + String(el.className).split(" ")[0] : "")).slice(0, 48);
      }),
    };
  }

  // --- the floater, and what it covers
  const fl = document.querySelector("#wss-floater");
  const flr = fl ? fl.getBoundingClientRect() : null;
  const overlapPct = (r) => {
    if (!flr || !r.width || !r.height) return 0;
    const w = Math.max(0, Math.min(flr.right, r.right) - Math.max(flr.left, r.left));
    const h = Math.max(0, Math.min(flr.bottom, r.bottom) - Math.max(flr.top, r.top));
    return Math.round((w * h) / (r.width * r.height) * 100);
  };

  // --- primary CTA: the most prominent call-to-action above the fold
  const ctaWords = /quote|estimate|schedule|book|call|contact|appointment|consult|request|get started|free/i;
  const ctas = [...document.querySelectorAll("a,button")].filter(vis).filter((e) => {
    const r = e.getBoundingClientRect();
    return r.top < innerHeight * 1.2 && r.width > 60 && r.height > 24 && ctaWords.test(txt(e));
  }).map((e) => { const r = e.getBoundingClientRect();
    return { text: txt(e).slice(0, 60), area: r.width * r.height, top: Math.round(r.top), covered: overlapPct(r) }; })
    .sort((a, b) => b.area - a.area);

  // anything of the client's the floater sits on
  const covered = [...document.querySelectorAll("a,button,h1,h2,img")].filter(vis)
    .filter((e) => !(e.closest && e.closest("#wss-floater")))
    .map((e) => ({ tag: e.tagName, text: txt(e).slice(0, 44), pct: overlapPct(e.getBoundingClientRect()) }))
    .filter((x) => x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 6);

  // --- services.
  //
  // FINDING THE SECTION IS THE HARD PART, and getting it wrong reports zero
  // services for a site that renders a dozen. Class names on these donors are
  // bundler-hashed, so an id/class match alone found nothing on a page whose
  // own menu links to "#services". Three ways in, deduped:
  //   1. an element whose id/class actually says services
  //   2. whatever the client's own nav anchor (#services) points at
  //   3. the container holding the heading that READS "Services"
  const secs = new Set();
  for (const s of document.querySelectorAll("section,div,main")) {
    const id = ((s.id || "") + " " + (typeof s.className === "string" ? s.className : "")).toLowerCase();
    if (/service|offer|what-we-do|capabilit/.test(id)) secs.add(s);
  }
  for (const a of document.querySelectorAll('a[href*="#service"]')) {
    const id = (a.getAttribute("href") || "").split("#")[1];
    if (!id) continue;
    const t = document.getElementById(id);
    if (t) secs.add(t);
  }
  for (const h of document.querySelectorAll("h2,h3")) {
    if (!vis(h)) continue;
    if (!/^(our |the )?(services|what we do|our work)\\b/i.test(txt(h))) continue;
    let host = h.parentElement;
    for (let i = 0; i < 3 && host; i++) {
      if (host.querySelectorAll("h3,h4").length >= 3) break;
      host = host.parentElement;
    }
    if (host) secs.add(host);
  }
  // WIDENING THE SEARCH WIDENED THE MISTAKES. The three ways in above can each
  // land on a container that also holds the site's own menu, and the menu's
  // "Services" and "Contact" then read as two published services — a defect
  // this file would have INVENTED and reported against a page whose sixteen
  // real service names were sitting right there. Nav and header are excluded,
  // and so is the section's own title, so what is left is the cards.
  const svcSeen = new Set(); const svc = [];
  for (const s of secs) {
    for (const h of s.querySelectorAll("h2,h3,h4,dt,strong")) {
      if (!vis(h)) continue;
      if (h.closest("nav,header,footer")) continue;
      let t = txt(h);
      if (!t || t.length > 70 || t.length < 3) continue;
      // The donor numbers its cards ("01AC Repair"); that counter is chrome.
      t = t.replace(/^\\s*\\d{1,2}\\s*(?=[A-Z])/, "").trim();
      // The section's own title is not one of the things it lists.
      if (/^(our |the )?(services|what we do|our work)\\b/i.test(t)) continue;
      const k = t.toLowerCase();
      if (svcSeen.has(k)) continue;
      svcSeen.add(k); svc.push(t);
    }
    if (svc.length > 40) break;
  }

  // --- hero picture: the biggest image or background in the first screenful
  let hero = null;
  const cands = [];
  for (const im of [...document.querySelectorAll("img")].filter(vis)) {
    const r = im.getBoundingClientRect();
    if (r.top > innerHeight) continue;
    cands.push({ kind: "img", url: im.currentSrc || im.src, area: r.width * r.height, top: Math.round(r.top) });
  }
  for (const el of [...document.querySelectorAll("section,div,header")].slice(0, 400)) {
    const r = el.getBoundingClientRect();
    if (r.top > innerHeight || r.width * r.height < 40000) continue;
    const bi = getComputedStyle(el).backgroundImage;
    const m = bi && bi.match(/url\\(["']?([^"')]+)/);
    if (m) cands.push({ kind: "bg", url: m[1], area: r.width * r.height, top: Math.round(r.top) });
  }
  for (const v of [...document.querySelectorAll("video")].filter(vis)) {
    const r = v.getBoundingClientRect();
    cands.push({ kind: "video", url: v.currentSrc || v.src || (v.querySelector("source") || {}).src || "", area: r.width * r.height, top: Math.round(r.top) });
  }
  cands.sort((a, b) => b.area - a.area);
  hero = cands[0] || null;

  // --- accent: the colours the page actually paints on buttons and headings
  const tally = {};
  for (const e of [...document.querySelectorAll("a,button,h1,h2,h3,svg,span")].slice(0, 800)) {
    if (!vis(e)) continue;
    if (e.closest && e.closest("#wss-floater")) continue;
    const s = getComputedStyle(e);
    for (const c of [s.backgroundColor, s.color, s.borderTopColor]) {
      if (!c || /rgba\\(0, 0, 0, 0\\)/.test(c)) continue;
      tally[c] = (tally[c] || 0) + 1;
    }
  }

  return {
    title: document.title,
    h1s, logoProbe,
    floater: flr ? { l: Math.round(flr.left), t: Math.round(flr.top), w: Math.round(flr.width), h: Math.round(flr.height),
      placement: (fl.getAttribute && fl.getAttribute("data-wss-placement")) || (document.querySelector("#wss-floater [data-wss-placement]") || {}).dataset?.wssPlacement || "" } : null,
    ctas: ctas.slice(0, 5), covered,
    services: svc.slice(0, 24),
    hero, bodyBg, htmlBg, paintedBg, bgChain: chain.slice(0, 4),
    colours: Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14),
    bodyText: (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 4000),
  };
})()`;

async function fetchBytes(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(25000) });
    if (!r.ok) return { status: r.status, buf: null };
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
  } catch (e) { return { status: 0, error: String(e.message || e).slice(0, 70), buf: null }; }
}

async function main() {
  const listPath = arg("list", "artifacts/varied-markets-run.json");
  const p = path.isAbsolute(listPath) ? listPath : path.join(ROOT, listPath);
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const rows = (Array.isArray(raw) ? raw : raw.picked || []).filter((r) => r.url);
  fs.mkdirSync(SHOTDIR, { recursive: true });

  const browser = await chromium.launch();
  const results = [];

  for (const row of rows) {
    const slug = String(row.url).replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "").slice(0, 60);
    const rec = {
      name: row.name, city: row.city, state: row.state,
      // The town the page is ENTITLED to name — often not the postal one. Left
      // off this object once already, which made the marketing-city fix look
      // like it had not worked and reported two correct pages as defective.
      marketingCity: row.marketingCity || "",
      expectedTrade: row.expectedTrade || row.trade || "", donor: row.donor || "",
      url: row.url, views: {}, problems: [],
    };
    const slots = rec.donor ? donorSlots(rec.donor) : [];

    for (const [label, size] of [["1280", { width: 1280, height: 800 }], ["390", { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      let probe = null; let err = "";
      try {
        await page.goto(row.url, { waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(2200);
        probe = await page.evaluate(PAGE_PROBE);
        await page.screenshot({ path: path.join(SHOTDIR, `${slug}.${label}.png`), fullPage: false });
      } catch (e) { err = String(e.message || e).slice(0, 160); }
      await ctx.close();
      if (!probe) { rec.views[label] = { error: err }; rec.problems.push(`${label}: render failed — ${err}`); continue; }

      const lum = luminance(probe.paintedBg);
      const view = {
        title: probe.title, h1: probe.h1s[0] || "", h1count: probe.h1s.length,
        paintedBg: probe.paintedBg, luminance: lum === null ? null : Number(lum.toFixed(3)),
        surface: lum === null ? "unknown" : (lum >= 0.45 ? "light" : (lum <= 0.18 ? "dark" : "mid")),
        logo: probe.logoProbe, floater: probe.floater,
        cta: probe.ctas[0] || null, ctaCovered: probe.ctas[0] ? probe.ctas[0].covered : null,
        covered: probe.covered, services: probe.services, hero: probe.hero,
        colours: probe.colours.map(([c, n]) => ({ hex: hexOf(c), n })).filter((x) => x.hex),
      };
      rec.views[label] = view;

      // --- LOGO: nothing of ours may be painted on their mark
      if (view.logo) {
        const bad = view.logo.hits.filter((h) => h !== "logo");
        const ours = view.logo.hits.filter((h) => /FLOATER/.test(h));
        if (ours.length) rec.problems.push(`${label}: FLOATER covers the logo (${ours.join(", ")})`);
        else if (bad.length === 3) rec.problems.push(`${label}: logo hit-test returned ${bad.join(", ")} — mark may be obscured`);
      } else rec.problems.push(`${label}: no header logo found`);

      // --- CTA
      if (view.cta && view.cta.covered > 10) rec.problems.push(`${label}: primary CTA "${view.cta.text}" ${view.cta.covered}% covered`);

      // --- SURFACE
      if (view.surface === "dark") rec.problems.push(`${label}: surface measured DARK (bg ${view.paintedBg}, luminance ${view.luminance})`);
    }

    // --- IDENTITY (from the 1280 view)
    const v = rec.views["1280"] || {};
    const nameWords = String(rec.name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !["llc", "inc", "the", "and", "company", "co"].includes(w));
    const hasName = (s) => { const t = String(s || "").toLowerCase(); return nameWords.length ? nameWords.filter((w) => t.includes(w)).length / nameWords.length >= 0.5 : false; };
    const hasCity = (s) => {
      const t = String(s || "").toLowerCase();
      return [rec.city, rec.marketingCity].filter(Boolean).some((c) => t.includes(String(c).toLowerCase()));
    };
    rec.identity = {
      title: v.title || "", h1: v.h1 || "",
      titleHasName: hasName(v.title), titleHasCity: hasCity(v.title),
      h1HasName: hasName(v.h1), h1HasCity: hasCity(v.h1),
      distinct: String(v.title || "").trim().toLowerCase() !== String(v.h1 || "").trim().toLowerCase(),
    };
    // --- TRADE, READ OFF THE PAGE.
    //
    // A rebuild once published M & M Heating & Cooling, an HVAC company, as
    // "Plumbing in Stratford, CT" — with every gate green, because the gates
    // agreed with each other about a label that was wrong. So the trade is
    // checked where a customer would see it: in the words on the page. The
    // WRONG trade appearing is a harder failure than the right one missing.
    const TRADE_WORDS = {
      hvac: /\b(hvac|heating|air conditioning|furnace|ac repair)\b/i,
      plumbing: /\b(plumb\w*|drain|water heater)\b/i,
      roofing: /\b(roof\w*)\b/i,
      fencing: /\b(fenc\w*)\b/i,
      landscaping: /\b(landscap\w*|lawn)\b/i,
      concrete: /\b(concrete|paving)\b/i,
      tattoo: /\b(tattoo|piercing)\b/i,
      salon: /\b(salon|nails?|hair)\b/i,
    };
    // The business's OWN NAME is not evidence and must not be searched: "Ed Rike
    // Plumbing Heating & Air" contains three trades before the engine writes a
    // word. What is checked is the engine's GENERATED claim — the
    // "<trade> in <City>" clause it composes into the title and h1, and the
    // "<trade> Contractor" clause in the title — read out and matched on its own.
    //
    // THE TOWN IN THE HEADLINE IS NOT ALWAYS THE POSTAL TOWN, AND THAT IS
    // CORRECT. Farr Better Plumbing's NAP city is Republic, MO; they publish
    // "Springfield" themselves and the lane uses it, so the page reads
    // "Plumbing in Springfield, MO". This file reported that as two defects
    // ("no trade for Republic", "title does not carry the city") until the
    // stored provenance was read — the marketing city is first-party evidence
    // and outranks the postal one by design. Both are accepted here.
    const towns = [rec.city, rec.marketingCity].filter(Boolean);
    const claims = [];
    for (const s of [v.title || "", v.h1 || ""]) {
      for (const town of towns) {
        const cityRe = String(town).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (const m of s.matchAll(new RegExp(`([A-Za-z &/-]{2,30}?)\\s+in\\s+${cityRe}\\b`, "gi"))) claims.push(m[1].trim());
      }
      for (const m of s.matchAll(/([A-Za-z &/-]{2,30}?)\s+Contractor\b/gi)) claims.push(m[1].trim());
    }
    // A STATE IS NOT A TOWN. "HVAC Contractor in Texas, TX" shipped live.
    const STATE_NAME_OF = { AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york", NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming" };
    const ownState = STATE_NAME_OF[String(rec.state || "").toUpperCase()];
    const stutter = ownState
      && new RegExp(`\\bin\\s+${ownState}\\s*,\\s*${rec.state}\\b`, "i").test(`${v.title || ""} ${v.h1 || ""}`);
    if (stutter) rec.problems.push(`the page names the STATE where the town belongs: "in ${ownState}, ${rec.state}" — a statewide claim rendered in the city slot`);
    const claimText = claims.join(" | ");
    const want = TRADE_WORDS[rec.expectedTrade];
    const wrong = Object.entries(TRADE_WORDS)
      .filter(([t, re]) => t !== rec.expectedTrade && re.test(claimText))
      .map(([t]) => t);
    rec.tradeOnPage = {
      expected: rec.expectedTrade,
      claims, saysExpected: want ? want.test(claimText) : null, alsoSays: wrong,
    };
    if (!claims.length) rec.problems.push(`the page states no trade for ${rec.city} in its title or h1`);
    else if (want && !want.test(claimText)) rec.problems.push(`the page calls them "${claimText}", not ${rec.expectedTrade}`);
    if (wrong.length) rec.problems.push(`the page publishes them as ${wrong.join(" and ")} ("${claimText}"), but their own services prove ${rec.expectedTrade}`);

    if (!rec.identity.titleHasName) rec.problems.push(`title does not carry the business name: "${v.title}"`);
    if (!rec.identity.titleHasCity) rec.problems.push(`title does not carry the city "${rec.city}": "${v.title}"`);
    if (!rec.identity.h1HasName) rec.problems.push(`h1 does not carry the business name: "${v.h1}"`);
    if (!rec.identity.distinct) rec.problems.push(`h1 and title are identical`);

    // --- SERVICES
    const svc = (v.services || []).map((s) => s.trim()).filter(Boolean);
    const junk = svc.filter((s) => NOT_A_SERVICE.includes(s.toLowerCase()));
    rec.services = { count: svc.length, list: svc, navLabels: junk };
    if (junk.length) rec.problems.push(`services include nav labels: ${junk.join(", ")}`);
    if (svc.length < 3) rec.problems.push(`only ${svc.length} service(s) rendered`);

    // --- HERO, by bytes
    if (v.hero && v.hero.url) {
      const heroUrl = v.hero.url.startsWith("http") ? v.hero.url : new URL(v.hero.url, row.url).href;
      const got = await fetchBytes(heroUrl);
      const relPath = (() => { try { return new URL(heroUrl).pathname.replace(/^\//, ""); } catch { return ""; } })();
      const slot = slots.find((s) => s.rel === relPath);
      let verdict = "unknown";
      if (!got.buf) verdict = `unfetchable(${got.status || got.error})`;
      else if (slot && slot.sha && sha(got.buf) === slot.sha) verdict = "DONOR STOCK";
      else if (slot) verdict = "client_own (donor slot overwritten)";
      else if (/^https?:\/\//.test(v.hero.url) && !new URL(heroUrl).host.endsWith("wss-ai.com")) verdict = "off-host";
      else verdict = "client_own (not a donor slot)";
      rec.hero = { kind: v.hero.kind, url: heroUrl, bytes: got.buf ? got.buf.length : 0, sha: got.buf ? sha(got.buf).slice(0, 12) : "", isDonorSlot: !!slot, verdict };
      if (verdict === "DONOR STOCK") rec.problems.push(`hero is the DONOR's stock photograph, byte-identical to donors-clean/${rec.donor}/${relPath}`);
    } else { rec.hero = { verdict: "no hero image found" }; rec.problems.push(`no hero image found`); }

    // --- PHOTO COVERAGE, by bytes, across every slot the donor declares.
    //
    // The hero alone is one picture. This is the whole gallery: for each slot
    // the donor ships, is the file this host SERVES the donor's original or
    // something else? The donor's byte-for-byte original is in this repo, so
    // the comparison needs neither the build report nor the store to agree.
    if (slots.length) {
      let own = 0; let stock = 0; let missing = 0; const detail = [];
      for (const s of slots) {
        const got = await fetchBytes(new URL(s.rel, row.url).href);
        if (!got.buf) { missing++; detail.push({ slot: s.rel, verdict: "not_served" }); continue; }
        if (s.sha && sha(got.buf) === s.sha) { stock++; detail.push({ slot: s.rel, verdict: "donor_stock" }); }
        else { own++; detail.push({ slot: s.rel, verdict: "client_own", bytes: got.buf.length }); }
      }
      rec.photoCoverage = { slots: slots.length, client_own: own, donor_stock: stock, missing, detail };
      if (own === 0 && slots.length) rec.problems.push(`every one of the ${slots.length} donor photo slots still serves the DONOR's stock picture — none of their own photography reached the page`);
    } else rec.photoCoverage = { slots: 0, note: `donor ${rec.donor} declares no photo slots` };

    // --- ACCENT
    rec.accentSeen = (v.colours || []).slice(0, 8);
    results.push(rec);

    const ok = rec.problems.length === 0;
    console.log(`\n${ok ? "PASS" : "PROBLEMS"}  ${rec.name} — ${rec.city}, ${rec.state} (${rec.expectedTrade}, donor ${rec.donor})`);
    console.log(`   title : ${rec.identity.title}`);
    console.log(`   h1    : ${rec.identity.h1}`);
    console.log(`   surf  : 1280=${(rec.views["1280"] || {}).surface} 390=${(rec.views["390"] || {}).surface}  bg=${(rec.views["1280"] || {}).paintedBg}`);
    console.log(`   logo  : 1280=${JSON.stringify(((rec.views["1280"] || {}).logo || {}).hits || "n/a")} 390=${JSON.stringify(((rec.views["390"] || {}).logo || {}).hits || "n/a")}`);
    console.log(`   hero  : ${rec.hero.verdict}  ${String(rec.hero.url || "").slice(0, 92)}`);
    console.log(`   photos: ${rec.photoCoverage.slots ? `${rec.photoCoverage.client_own}/${rec.photoCoverage.slots} slots serve THEIR picture (donor stock ${rec.photoCoverage.donor_stock}, missing ${rec.photoCoverage.missing})` : rec.photoCoverage.note}`);
    console.log(`   accent: ${(rec.accentSeen || []).slice(0, 5).map((c) => `${c.hex}x${c.n}`).join(" ")}`);
    console.log(`   svc(${rec.services.count}): ${rec.services.list.slice(0, 8).join(" / ").slice(0, 150)}`);
    for (const pr of rec.problems) console.log(`   !! ${pr}`);

    fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(results, null, 1));
  }

  await browser.close();

  // ---------------------------------------------------------------------
  // THE HERO CHECK THAT ACTUALLY CATCHES A SHARED HERO
  //
  // Per-host, the hero test above asks "is this the donor's file at the
  // donor's declared photo slot?" — and passed all ten, because the hero is
  // NOT at a declared slot. It sits at /hero/hero-poster.jpg (or
  // /assets/hero.mp4), so every host answered "client_own (not a donor slot)"
  // for a picture that is the donor's stock and identical everywhere.
  //
  // A shared asset is invisible from inside one page. It is only visible
  // ACROSS pages, so the comparison has to be across pages: hash the hero
  // every host actually serves and count the distinct ones. Ten sites sharing
  // two heroes is the whole defect in one number.
  const byHero = new Map();
  for (const r of results) {
    if (!r.hero || !r.hero.sha) continue;
    if (!byHero.has(r.hero.sha)) byHero.set(r.hero.sha, []);
    byHero.get(r.hero.sha).push(r.name);
  }
  const shared = [...byHero.entries()].filter(([, names]) => names.length > 1);
  for (const r of results) {
    const mates = (byHero.get(r.hero && r.hero.sha) || []).filter((n) => n !== r.name);
    if (mates.length) {
      r.hero.sharedWith = mates;
      r.problems.push(`hero is byte-identical to ${mates.length} other mirror(s) — ${mates.slice(0, 3).join(", ")}${mates.length > 3 ? "…" : ""}`);
    }
  }
  console.log(`\n--- hero uniqueness across the ${results.length} mirrors ---`);
  console.log(`distinct hero assets: ${byHero.size}/${results.length}`);
  for (const [sha, names] of shared) console.log(`  SHARED ${sha} on ${names.length}: ${names.join(" | ")}`);

  const clean = results.filter((r) => !r.problems.length);
  console.log(`\n=== ${clean.length}/${results.length} clean ===`);
  for (const r of results.filter((x) => x.problems.length)) console.log(`  ${r.name}: ${r.problems.length} problem(s) — ${r.problems[0]}`);
  console.log(`shots in ${SHOTDIR}`);
  console.log(`wrote ${path.join(ROOT, OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
