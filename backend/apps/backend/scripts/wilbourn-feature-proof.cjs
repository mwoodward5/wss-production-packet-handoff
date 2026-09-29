"use strict";
// scripts/flint-feature-proof.cjs — ground each offer chip against THIS build.
//
// product-claims.json verifies the 15 features at PRODUCT level, on the Ramon
// mirror. That is not proof for Flint. This probe renders the Flint mirror and
// reads the actual surfaces, so a chip that cannot be seen on this page is
// reported as unseen instead of inherited.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const NEW = "https://wss-test-wilbourn-and-mccabe-plumbing.wss-ai.com";
const OUT = path.join(__dirname, "../artifacts/wilbourn-feature-proof.json");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const out = { probed_at: new Date().toISOString(), origin: NEW };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  try {
    await page.goto(NEW + "/", { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(3000);

    out.home = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const txt = document.body.innerText;
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .map((s) => { try { return JSON.parse(s.textContent); } catch { return null; } })
        .filter(Boolean);
      const nodes = ld.flatMap((g) => (g["@graph"] ? g["@graph"] : [g]));
      const biz = nodes.find((n) => /LocalBusiness/i.test(JSON.stringify(n["@type"])));
      const links = [...document.querySelectorAll("a[href]")].map((a) => a.href);
      return {
        streetAddress: biz && biz.address ? biz.address.streetAddress : null,
        addressRegion: biz && biz.address ? biz.address.addressRegion : null,
        geo: biz && biz.geo ? { lat: biz.geo.latitude, lng: biz.geo.longitude } : null,
        hasAggregateRating: Boolean(biz && biz.aggregateRating),
        // The embed src carries the Maps browser key. It is public on the live
        // page, but it does not belong in a checked-in artifact — redact on the
        // way out. Only the presence of the embed is load-bearing here.
        mapsIframes: [...document.querySelectorAll("iframe")].map((f) => f.src).filter(Boolean)
          .map((u) => u.replace(/key=[^&]+/i, "key=[REDACTED]")),
        googleMapsLinks: links.filter((h) => /google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo/i.test(h)),
        appleMapsLinks: links.filter((h) => /maps\.apple\.com/i.test(h)),
        telLinks: [...new Set(links.filter((h) => h.startsWith("tel:")))],
        socialLinks: links.filter((h) => /facebook|instagram|linkedin|tiktok|(^|\/\/)(x|twitter)\.com/i.test(h)),
        navLinks: [...new Set(links.filter((h) => h.startsWith("https://wss-test-wilbourn")))].slice(0, 20),
        visibleAddressBlock: (txt.match(/[^\n]*Buda[^\n]*/g) || []),
        visibleServing: (txt.match(/[^\n]*Serving[^\n]*/g) || []),
        heroHasVideo: /<video/i.test(html),
        heroBgImages: (html.match(/background-image:\s*url\([^)]+\)/gi) || []).length,
        logoImgs: [...document.querySelectorAll("img")].map((i) => i.currentSrc || i.src).slice(0, 8),
        reviewNames: (txt.match(/Susan Shuffield|Janis Sills|Roger Garza/g) || []),
        rawTokenLeak: /\{\{[A-Z_]+\}\}/.test(html),
      };
    });

    // llms.txt + service-area page + headers, all from the real browser context.
    const sub = async (p) => {
      const r = await page.request.get(NEW + p);
      const body = r.ok() ? (await r.text()) : "";
      return { path: p, status: r.status(), bytes: body.length, head: body.slice(0, 300) };
    };
    out.llmsTxt = await sub("/llms.txt");
    out.robots = await sub("/robots.txt");
    out.sitemap = await sub("/sitemap.xml");

    const head = await page.request.get(NEW + "/");
    out.responseHeaders = {
      status: head.status(),
      contentType: head.headers()["content-type"] || null,
      strictTransportSecurity: head.headers()["strict-transport-security"] || null,
      server: head.headers()["server"] || null,
    };

    // service-area route (the Apple Maps surface per the registry)
    try {
      const r = await page.goto(NEW + "/service-area", { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2000);
      out.serviceArea = await page.evaluate(() => {
        const links = [...document.querySelectorAll("a[href]")].map((a) => a.href);
        return {
          title: document.title,
          h1: [...document.querySelectorAll("h1")].map((n) => n.innerText.trim()),
          appleMaps: links.filter((h) => /maps\.apple\.com/i.test(h)),
          googleMaps: links.filter((h) => /google\.[a-z.]+\/maps|maps\.google|maps\.app\.goo/i.test(h)),
          iframes: [...document.querySelectorAll("iframe")].map((f) => f.src).filter(Boolean),
          austin: (document.body.innerText.match(/Austin/g) || []).length,
          buda: (document.body.innerText.match(/Buda/g) || []).length,
        };
      });
      out.serviceArea.status = r ? r.status() : null;
    } catch (e) { out.serviceArea = { error: e.message }; }
  } finally {
    await ctx.close();
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
})();
