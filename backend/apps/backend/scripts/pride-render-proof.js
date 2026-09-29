"use strict";

// scripts/pride-render-proof.js — RENDER THE PAGE, THEN SAY WHAT IS ON IT.
//
// Reads the hydrated DOM of a live mirror and reports every pride point by
// name: present with its rendered text, or absent. Screenshots at 1280 and
// 390. The build report already says the engine rendered a pride block; this
// is the only thing that proves a person would see it.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const argOf = (flag, fallback) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : fallback;
const URL_ = argOf("--url", "");
const NAME = argOf("--name", "mirror");
const OUTDIR = argOf("--outdir", path.join(__dirname, "..", "artifacts", "pride-proof"));

const PROBE = () => {
  const txt = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const all = (sel) => Array.from(document.querySelectorAll(sel)).map(txt).filter(Boolean);
  const section = document.querySelector('[data-wss-pride="block"]');
  const offers = document.querySelector('[data-wss-pride="offers"]');
  const badgeImgs = Array.from(document.querySelectorAll(".wss-p__badge")).map((i) => i.getAttribute("src") || "");
  return {
    h1: txt(document.querySelector("h1")).slice(0, 200),
    prideSection: !!section,
    offersSection: !!offers,
    standing: all('[data-wss-pride="standing"]'),
    credentials: all('[data-wss-pride="credential"]'),
    differentiators: all('[data-wss-pride="differentiator"]'),
    plans: Array.from(document.querySelectorAll('[data-wss-pride="plan"]')).map((el) => ({
      name: txt(el.querySelector("h3")),
      price: txt(el.querySelector(".wss-p__price")),
      lines: Array.from(el.querySelectorAll(".wss-p__lines li")).map(txt),
    })),
    promotions: all('[data-wss-pride="promotion"]'),
    cities: all('[data-wss-pride="city"]'),
    regions: txt(document.querySelector(".wss-p__regions")),
    badgeImages: badgeImgs,
    // the trust pack, on the same page, measured the same way
    rating: txt(document.querySelector(".wss-t__num")) + " / " + txt(document.querySelector(".wss-t__sub")),
    reviewerFaces: document.querySelectorAll(".wss-t__faces img, img.wss-c__face").length,
    appleMaps: !!document.querySelector('a[href*="maps.apple.com"]'),
    writeReview: !!document.querySelector('a[href*="search.google.com/local/writereview"]'),
    reviewQuotes: document.querySelectorAll("blockquote.wss-c__quote").length,
    rawTokens: /\{\{[A-Z_]+\}\}/.test(document.body.innerHTML),
  };
};

async function main() {
  if (!URL_) { console.error("--url required"); process.exit(2); }
  fs.mkdirSync(OUTDIR, { recursive: true });
  const browser = await chromium.launch();
  const results = {};
  for (const [label, width, height] of [["1280", 1280, 900], ["390", 390, 844]]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 2,
      ...(width < 500 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await ctx.newPage();
    await page.goto(URL_, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(600);

    const probe = await page.evaluate(PROBE);
    results[label] = probe;

    const full = path.join(OUTDIR, `${NAME}-${label}-full.png`);
    await page.screenshot({ path: full, fullPage: true });
    // The pride sections on their own, so the owner can see the thing he asked
    // about without hunting a full-page strip for it.
    for (const [sel, tag] of [['[data-wss-pride="block"]', "credentials"], ['[data-wss-pride="offers"]', "plans"], ["section.wss-t", "trustrail"]]) {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
        await el.screenshot({ path: path.join(OUTDIR, `${NAME}-${label}-${tag}.png`) });
      }
    }
    await ctx.close();
    console.log(`captured ${label}`);
  }
  await browser.close();

  const p = results["1280"];
  console.log(`\n=== ${URL_} ===`);
  console.log(`h1                : ${p.h1}`);
  console.log(`raw {{TOKENS}}    : ${p.rawTokens ? "PRESENT (defect)" : "none"}`);
  console.log(`\n-- owner pride --`);
  console.log(`pride section     : ${p.prideSection ? "PRESENT" : "ABSENT"}`);
  console.log(`standing          : ${p.standing.length ? p.standing.join(" | ") : "ABSENT"}`);
  console.log(`credentials (${p.credentials.length})   : ${p.credentials.join(" | ") || "ABSENT"}`);
  console.log(`badge <img> count : ${p.badgeImages.length} ${p.badgeImages.join(" ")}`);
  console.log(`differentiators   : ${p.differentiators.join(" | ") || "ABSENT"}`);
  console.log(`plans section     : ${p.offersSection ? "PRESENT" : "ABSENT"}`);
  for (const pl of p.plans) console.log(`  plan            : ${pl.name} — ${pl.price} — ${pl.lines.join("; ")}`);
  console.log(`promotions        : ${p.promotions.join(" | ") || "ABSENT"}`);
  console.log(`regions           : ${p.regions || "ABSENT"}`);
  console.log(`cities (${p.cities.length})        : ${p.cities.join(", ") || "ABSENT"}`);
  console.log(`\n-- trust pack --`);
  console.log(`rating            : ${p.rating}`);
  console.log(`reviewer faces    : ${p.reviewerFaces}`);
  console.log(`review quotes     : ${p.reviewQuotes}`);
  console.log(`apple maps        : ${p.appleMaps ? "PRESENT" : "ABSENT"}`);
  console.log(`write-a-review    : ${p.writeReview ? "PRESENT" : "ABSENT"}`);
  console.log(`\n-- 390 viewport --`);
  const m = results["390"];
  console.log(`pride section     : ${m.prideSection ? "PRESENT" : "ABSENT"}   plans: ${m.offersSection ? "PRESENT" : "ABSENT"}   cities: ${m.cities.length}   credentials: ${m.credentials.length}`);

  fs.writeFileSync(path.join(OUTDIR, `${NAME}-probe.json`), JSON.stringify({ url: URL_, at: new Date().toISOString(), results }, null, 2));
  console.log(`\nshots + probe in ${OUTDIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
