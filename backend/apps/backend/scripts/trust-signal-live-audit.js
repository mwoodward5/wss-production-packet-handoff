"use strict";

// scripts/trust-signal-live-audit.js — WHAT IS ACTUALLY ON THE LIVE PAGES.
//
// The owner asked to see the trust pack working on a real site. A passing gate
// is not proof and neither is source code that contains the markup: these are
// React SPAs and the only honest answer comes from a rendered DOM. This script
// opens each live mirror in a real browser, waits for hydration, and reports
// per site which trust elements are PRESENT and which are ABSENT.
//
// Every probe is a DOM query against the rendered page — never a string search
// of the served HTML.

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const argOf = (flag, fallback) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback;
const LIMIT = Number(argOf("--limit", 8));
const OUT = argOf("--out", path.join(__dirname, "..", "artifacts", "trust-signal-live-audit.json"));
const ONLY = argOf("--host", "");

async function rest(query) {
  const r = await fetch(`${BASE}/rest/v1/${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}

/**
 * The probe runs INSIDE the page after hydration. Each key answers one
 * question a stranger would ask, and each answer carries the evidence that
 * produced it so a "present" can be checked by eye afterwards.
 */
const PROBE = () => {
  const q = (sel) => Array.from(document.querySelectorAll(sel));
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const bodyText = text(document.body);

  const rail = document.querySelector("section.wss-t, #trust");
  const score = document.querySelector(".wss-t__score");
  const scoreNum = text(document.querySelector(".wss-t__num"));
  const scoreSub = text(document.querySelector(".wss-t__sub"));

  const links = q("a[href]").map((a) => ({ href: a.getAttribute("href") || "", label: text(a).slice(0, 60) }));
  const appleMaps = links.filter((l) => /maps\.apple\.com/i.test(l.href));
  const writeReview = links.filter((l) => /search\.google\.com\/local\/writereview/i.test(l.href));
  const googleDir = links.filter((l) => /google\.com\/maps\/dir/i.test(l.href));

  const quotes = q("blockquote.wss-c__quote, .wss-t blockquote");
  const faces = q("img.wss-c__face, .wss-t__faces img, .wss-t img[alt=''], .wss-c__face");
  const faceSrcs = faces.map((i) => i.getAttribute("src") || "").filter(Boolean);

  // schema.org graph — read the JSON, do not regex the page
  let schema = { aggregateRating: null, reviewNodes: 0, types: [] };
  for (const s of q('script[type="application/ld+json"]')) {
    let data; try { data = JSON.parse(s.textContent || "{}"); } catch { continue; }
    const nodes = Array.isArray(data) ? data : (data["@graph"] || [data]);
    for (const n of nodes) {
      if (!n || typeof n !== "object") continue;
      if (n["@type"]) schema.types.push(String(n["@type"]));
      if (n.aggregateRating) {
        schema.aggregateRating = {
          value: n.aggregateRating.ratingValue ?? null,
          count: n.aggregateRating.reviewCount ?? null,
        };
      }
      if (Array.isArray(n.review)) schema.reviewNodes += n.review.length;
    }
  }

  const services = q(".wss-c #services li, section#services li, .wss-c__svc li");
  const hours = q("#hours tr, .wss-t__hours li, .wss-c #hours li");
  const faqs = q('[itemtype*="FAQPage"] , #faq details, #faq .wss-c__faq, section#faq li');

  // pride-point surfaces (what step 2 is about)
  const pride = {
    plans: q("[data-wss-pride='plans'] , .wss-p__plan").length,
    credentials: q("[data-wss-pride='credentials'], .wss-p__cred").length,
    footprint: q("[data-wss-pride='footprint'], .wss-p__city").length,
    block: !!document.querySelector("[data-wss-pride], section.wss-p"),
  };

  return {
    title: document.title || "",
    h1: text(document.querySelector("h1")).slice(0, 140),
    bodyChars: bodyText.length,
    trustRail: { present: !!rail, id: rail ? rail.id : "" },
    rating: { present: !!score, value: scoreNum, sub: scoreSub },
    appleMaps: { present: appleMaps.length > 0, hrefs: appleMaps.map((l) => l.href).slice(0, 2) },
    writeReview: { present: writeReview.length > 0, hrefs: writeReview.map((l) => l.href).slice(0, 2) },
    googleDirections: { present: googleDir.length > 0, count: googleDir.length },
    reviewQuotes: { present: quotes.length > 0, count: quotes.length, first: text(quotes[0]).slice(0, 120) },
    reviewerFaces: { present: faceSrcs.length > 0, count: faceSrcs.length, first: faceSrcs[0] || "" },
    schema,
    services: { count: services.length },
    hours: { count: hours.length },
    faqs: { count: faqs.length },
    pride,
    rawTokens: /\{\{[A-Z_]+\}\}/.test(document.body.innerHTML),
  };
};

async function main() {
  let targets = [];
  if (ONLY) {
    targets = ONLY.split(",").map((h) => ({ name: h, host: h.trim(), url: /^https?:/i.test(h) ? h.trim() : `https://${h.trim()}` }));
  } else {
    const rows = await rest(
      `ghost_agency_prospects?select=id,business_name,industry,city,state,preview_url,record,updated_at` +
      `&preview_url=not.is.null&order=updated_at.desc&limit=200`,
    );
    const seen = new Set();
    for (const row of Array.isArray(rows) ? rows : []) {
      const url = String(row.preview_url || "").trim();
      if (!/^https?:\/\//i.test(url)) continue;
      let host; try { host = new URL(url).hostname; } catch { continue; }
      if (seen.has(host)) continue;
      seen.add(host);
      targets.push({
        id: row.id, name: row.business_name || host,
        industry: row.industry || "", city: row.city || "", state: row.state || "",
        host, url,
        hasOwnerBehind: !!(row.record && row.record.owner_behind),
      });
      if (targets.length >= LIMIT) break;
    }
  }

  console.log(`rendering ${targets.length} live mirrors\n`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const results = [];
  for (const t of targets) {
    const page = await ctx.newPage();
    let out = { ...t, ok: false, error: "" };
    try {
      const resp = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      out.status = resp ? resp.status() : 0;
      await page.waitForTimeout(3500);          // hydration + lazy sections
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
      const probe = await page.evaluate(PROBE);
      out = { ...out, ok: true, ...probe };
    } catch (e) {
      out.error = String(e.message || e).slice(0, 180);
    }
    await page.close();
    results.push(out);
    const flag = (k) => (out[k] && out[k].present ? "YES" : "no ");
    console.log(
      `${(out.name || out.host).slice(0, 34).padEnd(34)} ${String(out.status || "-").padEnd(4)}` +
      ` rail:${flag("trustRail")} rating:${flag("rating")}${out.rating && out.rating.value ? "(" + out.rating.value + ")" : ""}` +
      ` faces:${out.reviewerFaces ? out.reviewerFaces.count : "-"}` +
      ` quotes:${out.reviewQuotes ? out.reviewQuotes.count : "-"}` +
      ` apple:${flag("appleMaps")} writerev:${flag("writeReview")}` +
      ` aggR:${out.schema && out.schema.aggregateRating ? "YES" : "no "}` +
      ` revSchema:${out.schema ? out.schema.reviewNodes : "-"}` +
      ` pride:${out.pride && out.pride.block ? "YES" : "no "}` +
      (out.error ? `  ERR ${out.error}` : ""),
    );
  }
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
