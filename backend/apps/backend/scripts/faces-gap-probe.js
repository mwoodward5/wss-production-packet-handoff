"use strict";
// Faces: data gap or render gap? Take the mirrors whose STORED reviews carry
// real Google-served photos, render the live page, and count the <img>s.

require("./brightdata-edit-proof/env").loadEnv();
const { chromium } = require("playwright");
const { isGoogleReviewerFace } = require("../lib/verified-trust-lookup");

const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(q) {
  const r = await fetch(`${BASE}/rest/v1/${q}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return []; }
}
function allReviews(obj, out = [], depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return out;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "reviews" && Array.isArray(v)) out.push(...v);
    else if (v && typeof v === "object") allReviews(v, out, depth + 1);
  }
  return out;
}
const avatarOf = (r) => String((r && (r.avatarUrl || r.avatar_url || r.profile_photo_url)) || "");

async function main() {
  const rows = await rest(`ghost_agency_prospects?select=business_name,preview_url,record&preview_url=not.is.null&limit=400`);
  const targets = [];
  for (const r of rows) {
    const revs = allReviews(r.record || {});
    const faces = revs.filter((x) => isGoogleReviewerFace(avatarOf(x)));
    if (faces.length) targets.push({ name: r.business_name, url: r.preview_url, stored: faces.length });
    if (targets.length >= 8) break;
  }
  console.log(`${targets.length} mirrors whose stored reviews carry real Google faces\n`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  for (const t of targets) {
    const page = await ctx.newPage();
    let rendered = -1, quotes = -1, status = 0;
    try {
      const resp = await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      status = resp ? resp.status() : 0;
      await page.waitForTimeout(3500);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
      const out = await page.evaluate(() => ({
        faces: document.querySelectorAll(".wss-t__faces img, img.wss-c__face").length,
        quotes: document.querySelectorAll("blockquote.wss-c__quote").length,
      }));
      rendered = out.faces; quotes = out.quotes;
    } catch (e) { /* reported as -1 */ }
    await page.close();
    const verdict = status !== 200 ? `HTTP ${status}`
      : rendered > 0 ? "faces rendered"
      : "RENDER GAP — stored faces, none on the page";
    console.log(`${String(t.name).slice(0, 32).padEnd(32)} stored:${String(t.stored).padEnd(2)} rendered:${String(rendered).padEnd(3)} quotes:${String(quotes).padEnd(3)} ${verdict}`);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
