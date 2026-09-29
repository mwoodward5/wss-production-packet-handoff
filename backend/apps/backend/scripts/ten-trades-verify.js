"use strict";
/**
 * scripts/ten-trades-verify.js — the wait-and-look pass over LIVE hosts.
 *
 * For each built mirror in a varied-markets-run result file:
 *   TRADE     the rendered page names the trade (word match on body text)
 *   IDENTITY  the h1 carries the business's own name fragment, not a donor
 *             slogan
 *   FLOATER   #wss-floater present at 1s AND STILL at 6s (post-hydration),
 *             with the Client ID rendered in it
 *   ERRORS    zero pageerrors across the whole wait
 *
 *   node scripts/ten-trades-verify.js --list artifacts/ten-trades-run.json
 */
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");
const { chromium } = require(path.join(ROOT, "node_modules", "playwright"));

const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const LIST = arg("list", "artifacts/ten-trades-run.json");
const OUT = arg("out", "artifacts/ten-trades-verify.json");

const TRADE_WORDS = {
  concrete: ["concrete"],
  tattoo: ["tattoo"],
  "med spa": ["med spa", "medspa", "aesthetics", "medical spa"],
  salon: ["salon", "nails", "nail"],
  fencing: ["fence", "fencing", "iron"],
  landscaping: ["landscape", "landscaping", "lawn"],
  roofing: ["roof", "roofing"],
  hvac: ["hvac", "heating", "cooling", "air conditioning"],
  plumbing: ["plumbing", "plumber"],
  electrical: ["electric", "electrical", "electrician"],
};

async function verifyOne(browser, { name, industry, preview_url }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.message) || e).slice(0, 140)));
  const out = { name, industry, url: preview_url };
  try {
    const resp = await page.goto(preview_url, { waitUntil: "domcontentloaded", timeout: 60000 });
    out.http = resp && resp.status();
    const sample = () => page.evaluate(() => ({
      floater: !!document.getElementById("wss-floater"),
      pill: !!document.getElementById("wss-pill"),
      card_open: (() => { const c = document.getElementById("wss-plan-card"); return !!c && !c.hidden; })(),
      floater_text: (() => { const f = document.getElementById("wss-floater"); return f ? (f.innerText || "").replace(/\s+/g, " ").slice(0, 300) : ""; })(),
      h1: ((document.querySelector("h1") || {}).textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      body: (document.body ? document.body.innerText : "").slice(0, 30000),
    }));
    await page.waitForTimeout(1000);
    const at1s = await sample();
    await page.waitForTimeout(5000);
    const at6s = await sample();
    const words = TRADE_WORDS[String(industry || "").toLowerCase()] || [String(industry || "").toLowerCase()];
    const bodyLc = (at6s.body || "").toLowerCase();
    const nameBit = String(name || "").split(/[^A-Za-z0-9']+/).filter((w) => w.length > 2)[0] || "";
    out.trade_named = words.some((w) => bodyLc.includes(w));
    out.h1 = at6s.h1;
    out.h1_carries_name = nameBit ? at6s.h1.toLowerCase().includes(nameBit.toLowerCase()) : false;
    out.floater_at_1s = at1s.floater && at1s.pill;
    out.floater_at_6s = at6s.floater && at6s.pill;
    out.card_open_at_6s = at6s.card_open;
    out.client_id_rendered = /client id/i.test(at6s.floater_text || "");
    out.page_errors = errs;
    out.verdict = out.trade_named && out.h1_carries_name && out.floater_at_6s && !errs.length ? "PASS" : "FAIL";
  } catch (e) {
    out.verdict = "FAIL";
    out.error = String((e && e.message) || e).slice(0, 200);
  }
  await page.close();
  return out;
}

(async () => {
  const p = path.isAbsolute(LIST) ? LIST : path.join(ROOT, LIST);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const rows = (Array.isArray(j) ? j : j.results || [])
    .map((r) => ({ ...r, industry: r.industry || r.label || r.vertical, preview_url: r.preview_url || r.url }))
    .filter((r) => r.preview_url);
  const browser = await chromium.launch();
  const out = [];
  for (const row of rows) {
    const v = await verifyOne(browser, row);
    out.push(v);
    console.log(`${v.verdict}  ${String(v.industry || "").padEnd(12)} ${String(v.name || "").slice(0, 34).padEnd(34)} floater@6s=${v.floater_at_6s} trade=${v.trade_named} h1name=${v.h1_carries_name} errs=${(v.page_errors || []).length} ${v.error || ""}`);
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 2));
  console.log(`wrote ${path.join(ROOT, OUT)}`);
})().catch((e) => { console.error(e); process.exit(1); });
