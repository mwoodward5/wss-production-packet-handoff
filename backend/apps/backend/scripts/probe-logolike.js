"use strict";
// scripts/probe-logolike.js — WHY do the owner photo, the team photo and the
// truck measure logoLike on familyhvac.net? Prints each image's alt, class,
// header-ancestry and rect — the four inputs of the logoLike predicate.
require("./brightdata-edit-proof/env").loadEnv();
const { chromium } = require("playwright");

const TARGETS = ["homepage-hero-circle-new2", "new-team-01", "hp-truck-new-2026"];

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("https://www.familyhvac.net/", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const out = await page.evaluate((targets) => {
    const rows = [];
    for (const img of document.images) {
      const url = img.currentSrc || img.src || "";
      if (!targets.some((t) => url.includes(t))) continue;
      const rect = img.getBoundingClientRect();
      const header = img.closest("header, nav, [class*='header' i], [class*='nav' i]");
      rows.push({
        url: url.slice(0, 110),
        alt: img.alt || "",
        className: String(img.className).slice(0, 120),
        inHeaderAncestor: header ? String(header.className || header.tagName).slice(0, 120) : null,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        natural: { w: img.naturalWidth, h: img.naturalHeight },
        regexHit: /logo|brand|wordmark|mark\b/i.test(url + " " + (img.alt || "") + " " + String(img.className)),
      });
    }
    return rows;
  }, TARGETS);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
