"use strict";
// scripts/flint-dom-proof.cjs — RENDER BOTH SITES. QC PASS is never proof.
//
// flintplumb.com returns 403 to a plain fetch (Cloudflare). A real browser gets
// the page, which is exactly why this probe drives Chromium instead of fetch().
// Read-only: it navigates, reads, and writes one JSON file. Nothing is sent.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const OLD = "https://wilbournmccabeplumbing.com/";
const NEW = "https://wss-test-wilbourn-and-mccabe-plumbing.wss-ai.com/";
const OUT = path.join(__dirname, "../artifacts/wilbourn-dom-proof.json");

async function probe(browser, url, label) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const rec = { label, url, ok: false };
  try {
    const res = await page.goto(url, { waitUntil: "load", timeout: 90000 });
    rec.httpStatus = res ? res.status() : null;
    rec.finalUrl = page.url();
    await page.waitForTimeout(2500); // let client-side render settle

    Object.assign(
      rec,
      await page.evaluate(() => {
        const txt = document.body ? document.body.innerText : "";
        const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } })
          .filter(Boolean);
        const nodes = ld.flatMap((g) => (g["@graph"] ? g["@graph"] : [g]));
        const biz = nodes.find((n) => /LocalBusiness|Plumber|Organization/i.test(String(n["@type"])));
        const count = (re) => (txt.match(re) || []).length;
        return {
          title: document.title,
          h1: [...document.querySelectorAll("h1")].map((n) => n.innerText.trim()).slice(0, 4),
          h2: [...document.querySelectorAll("h2")].map((n) => n.innerText.trim()).slice(0, 8),
          metaDescription: (document.querySelector('meta[name="description"]') || {}).content || null,
          ogTitle: (document.querySelector('meta[property="og:title"]') || {}).content || null,
          ldTypes: nodes.map((n) => n["@type"]),
          ldName: biz ? biz.name : null,
          ldAddressLocality: biz && biz.address ? biz.address.addressLocality : null,
          ldPostalCode: biz && biz.address ? biz.address.postalCode : null,
          ldStreetAddress: biz && biz.address ? biz.address.streetAddress : null,
          ldAreaServed: biz && biz.areaServed
            ? [].concat(biz.areaServed).map((a) => (typeof a === "string" ? a : a.name))
            : null,
          ldTelephone: biz ? biz.telephone || null : null,
          ldRating: biz && biz.aggregateRating
            ? { value: biz.aggregateRating.ratingValue, count: biz.aggregateRating.reviewCount || biz.aggregateRating.ratingCount }
            : null,
          dataCity: (document.querySelector("[data-city]") || {}).dataset
            ? document.querySelector("[data-city]").dataset.city : null,
          dataAddressCity: document.querySelector("[data-address-city]")
            ? document.querySelector("[data-address-city]").dataset.addressCity : null,
          austinCount: count(/Austin/gi),
          budaCount: count(/Buda/gi),
          plumbCount: count(/plumb/gi),
          roofCount: count(/roof/gi),
          hvacCount: count(/hvac/gi),
          bodyChars: txt.length,
          bodyFirst400: txt.slice(0, 400).replace(/\s+/g, " "),
          imgCount: document.images.length,
          videoCount: document.querySelectorAll("video").length,
          rawTokenLeak: /\{\{[A-Z_]+\}\}/.test(document.documentElement.innerHTML),
        };
      }),
    );
    rec.ok = true;
  } catch (e) {
    rec.error = e.message;
  } finally {
    await ctx.close();
  }
  return rec;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const out = { probed_at: new Date().toISOString(), sites: [] };
  try {
    out.sites.push(await probe(browser, OLD, "old_wilbournmccabeplumbing_com"));
    out.sites.push(await probe(browser, NEW, "new_mirror"));
  } finally {
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
})();
