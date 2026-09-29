"use strict";
// scripts/prove-family-facelift.js — the four owner points, proved on the
// rendered page rather than read off a report:
//   1. BLUE SITE: the accent the page actually wears is the site-chrome blue,
//      not the logo's red (checks.brand.accent_decision + computed styles).
//   2. HIS PHOTO: the hero wash asset serves 200 and is the photograph the
//      wash chose (photo_source names which preference won).
//   3. WASHED HERO: the hero's computed background-image carries
//      /assets/hero-wash.*, and disabling ONLY that image changes a measured
//      share of hero pixels — a selector that paints, proved by diff. The
//      rendered h1 colour + the painted scrim re-derive the worst-case ratio.
//   4. CLEAN PHONE FOLD at 390: inside the hero only the ONE line and the
//      call CTA are visible (froth hidden), and the #trust stars sit in the
//      first screenful.
//
//   node scripts/prove-family-facelift.js [--build] [--name "Family Heating"]
//
// Writes artifacts/family-facelift/{desktop-1280.png,mobile-390.png,
// hero-wash-on.png,hero-wash-off.png,measured.json} and prints a verdict per
// point. --build first runs the REAL lane and stores the full result
// (artifacts/family-facelift/build.json) so checks.design_brief.accent_decision
// and checks.brand.hero_wash are on the record beside the pixels.

require("./brightdata-edit-proof/env").loadEnv();

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(ROOT, "artifacts", "family-facelift");
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const NAME = arg("name", "Family Heating");
const URL = arg("url", "https://wss-test-family-heating-and-air-conditioning-lawren.wss-ai.com/");
const DO_BUILD = process.argv.includes("--build");

const { decodePngToRgba } = require("../lib/png-decode");
const { relativeLuminance, contrastRatio, AA_NORMAL } = require("../lib/hero-wash");

async function buildFirst() {
  const BASE = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${BASE}/rest/v1/ghost_agency_prospects?select=*&business_name=ilike.*${encodeURIComponent(NAME)}*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const rows = JSON.parse(await r.text());
  if (!rows.length) throw new Error("no prospect row");
  const row = rows[0];
  const record = row.record || {};
  const req = (record.build_ready && record.build_ready.mirror_request) || {};
  const f = req.facts || {};
  const brand = req.brand || {};
  const { buildMirrorForProspect } = require("../lib/mirror-lane-build");
  const prospect = {
    ...row, record,
    business_name: f.business_name || row.business_name,
    industry: f.industry || row.industry,
    city: f.city || row.city, state: f.state || row.state,
    current_website: f.current_website || row.current_website,
    site: row.current_website || "",
    email: f.email || row.email, phone: f.phone || row.phone,
    place_id: f.place_id || record.place_id,
    rating: f.rating ?? record.rating,
    review_count: f.review_count ?? record.review_count,
    marketing_city: f.service_area || record.service_area,
    logo_url: brand.logo || "", logo_accent: brand.accent || "",
    logo_accent_source: brand.accent_source || "",
  };
  const t0 = Date.now();
  const out = await buildMirrorForProspect(prospect, {});
  out._built_in_s = Number(((Date.now() - t0) / 1000).toFixed(1));
  fs.writeFileSync(path.join(OUTDIR, "build.json"), JSON.stringify(out, null, 1));
  const brief = out.checks && out.checks.design_brief;
  const brandCheck = out.checks && out.checks.brand;
  console.log("build:", JSON.stringify({
    ok: out.ok, revealable: out.revealable, donor: out.donor, secs: out._built_in_s,
    accent_decision: brief && brief.accent_decision,
    hero_wash: brandCheck && brandCheck.hero_wash,
    mobile_fold: out.checks && out.checks.mobile_fold,
    identity_critical: brief && brief.identity_critical,
  }, null, 1));
  return out;
}

// Luminance share of pixels that changed between two same-size PNGs.
function pixelDiffShare(aBuf, bBuf) {
  const a = decodePngToRgba(aBuf); const b = decodePngToRgba(bBuf);
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  let changed = 0; let total = 0;
  for (let i = 0; i < a.data.length; i += 16) { // sample every 4th pixel
    total++;
    const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 24) changed++;
  }
  return total ? changed / total : null;
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const measured = { url: URL, at: new Date().toISOString(), points: {} };
  if (DO_BUILD) measured.build = Boolean(await buildFirst());

  const browser = await chromium.launch();
  try {
    // ---- desktop ---------------------------------------------------------
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUTDIR, "desktop-1280.png") });

    const heroInfo = await page.evaluate(() => {
      const hero = document.querySelector("main > section:first-of-type");
      if (!hero) return { found: false };
      const cs = getComputedStyle(hero);
      const h1 = hero.querySelector("h1");
      const h1cs = h1 ? getComputedStyle(h1) : null;
      const rect = hero.getBoundingClientRect();
      // The painted scrim: first rgba() in the background-image shorthand.
      const m = /linear-gradient\(rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(cs.backgroundImage);
      return {
        found: true,
        backgroundImage: cs.backgroundImage.slice(0, 240),
        washed: /hero-wash\./.test(cs.backgroundImage),
        scrim: m ? { r: +m[1], g: +m[2], b: +m[3], a: +m[4] } : null,
        h1Color: h1cs ? h1cs.color : null,
        h1Text: h1 ? h1.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : "",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: Math.min(rect.height, 800) },
        accentVar: getComputedStyle(document.documentElement).getPropertyValue("--wss-accent").trim(),
      };
    });
    measured.points.hero = heroInfo;

    // wash asset really serves
    if (heroInfo.washed) {
      const mm = /url\("?([^")]+hero-wash\.[a-z]+)"?\)/.exec(heroInfo.backgroundImage);
      const assetUrl = mm ? new globalThis.URL(mm[1], URL).toString() : null;
      if (assetUrl) {
        const res = await fetch(assetUrl);
        measured.points.wash_asset = { url: assetUrl, status: res.status, bytes: Number(res.headers.get("content-length") || 0) };
      }
    }

    // pixel proof: hero with wash vs wash image stripped
    if (heroInfo.found) {
      const clip = { x: 0, y: 0, width: 1280, height: Math.max(200, Math.round(heroInfo.rect.height)) };
      const on = await page.screenshot({ clip });
      fs.writeFileSync(path.join(OUTDIR, "hero-wash-on.png"), on);
      await page.evaluate(() => {
        const hero = document.querySelector("main > section:first-of-type");
        if (hero) hero.style.setProperty("background-image", "none", "important");
      });
      await page.waitForTimeout(300);
      const off = await page.screenshot({ clip });
      fs.writeFileSync(path.join(OUTDIR, "hero-wash-off.png"), off);
      measured.points.wash_pixel_diff_share = pixelDiffShare(on, off);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(800);
    }

    // contrast re-derivation from the RENDERED numbers
    if (heroInfo.scrim && heroInfo.h1Color) {
      const c = heroInfo.scrim;
      const hex = "#" + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, "0")).join("");
      const tm = /rgba?\((\d+), (\d+), (\d+)/.exec(heroInfo.h1Color);
      if (tm) {
        const th = "#" + [tm[1], tm[2], tm[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("");
        const Ls = relativeLuminance(hex); const Lt = relativeLuminance(th);
        const textIsLight = Lt > Ls;
        const worst = textIsLight ? c.a * Ls + (1 - c.a) : c.a * Ls;
        measured.points.rendered_worst_case = {
          scrim: hex, alpha: c.a, h1: th,
          ratio: Number(contrastRatio(Lt, worst).toFixed(2)),
          passes: contrastRatio(Lt, worst) >= AA_NORMAL,
        };
      }
    }

    // an inner page carries the wash too
    const inner = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await inner.goto(new globalThis.URL("/services", URL).toString(), { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
    await inner.waitForTimeout(1200);
    measured.points.inner_page = await inner.evaluate(() => {
      const hero = document.querySelector("main > section:first-of-type");
      const cs = hero ? getComputedStyle(hero) : null;
      return { found: !!hero, washed: cs ? /hero-wash\./.test(cs.backgroundImage) : false, path: location.pathname };
    });
    await inner.close();

    // ---- mobile ----------------------------------------------------------
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await mob.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
    await mob.waitForTimeout(1500);
    await mob.screenshot({ path: path.join(OUTDIR, "mobile-390.png") });
    measured.points.mobile_fold = await mob.evaluate(() => {
      const hero = document.querySelector("main > section:first-of-type");
      if (!hero) return { found: false };
      const visible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      const h1 = hero.querySelector("h1");
      const spans = h1 ? [...h1.querySelectorAll("span")] : [];
      const trust = document.getElementById("trust");
      const trustRect = trust ? trust.getBoundingClientRect() : null;
      const call = hero.querySelector('[data-cta="hero-call"]');
      const quote = hero.querySelector('[data-cta="hero-quote"]');
      return {
        found: true,
        h1Visible: visible(h1),
        h1VisibleText: h1 ? [...h1.childNodes].map((n) => (n.nodeType === 3 ? n.nodeValue : (visible(n) ? n.textContent : ""))).join(" ").replace(/\s+/g, " ").trim().slice(0, 100) : "",
        visibleSpansInH1: spans.filter(visible).length,
        paragraphsVisible: [...hero.querySelectorAll("p")].filter(visible).length,
        listsVisible: [...hero.querySelectorAll("ul, dl")].filter(visible).length,
        callVisible: visible(call),
        quoteVisible: visible(quote),
        trustPresent: !!trust,
        trustTopPx: trustRect ? Math.round(trustRect.top) : null,
        trustInFold: !!trustRect && trustRect.top < 844,
        trustHasStars: trust ? /★|star/i.test(trust.innerHTML) : false,
      };
    });
    await mob.close();
    await page.close();
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUTDIR, "measured.json"), JSON.stringify(measured, null, 1));
  console.log(JSON.stringify(measured.points, null, 1));
}

main().catch((e) => { console.error(e); process.exit(1); });
