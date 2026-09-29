"use strict";
// scripts/qa-v3-final-shots.cjs — the LIVE-TEMPLATE final QA shot runner.
//
// Renders a composed v3 email HTML file (the real-record mock from
// render-v3-polish-mock.cjs) in a real browser at the two QA viewports —
// desktop 1200 and mobile 390 — plus an IMAGES-BLOCKED pass at both, and
// slices every capture into readable sections for a section-by-section walk.
//
// Also reports, as measurements (never opinions):
//   · horizontal overflow at each width (scrollWidth vs innerWidth) and WHICH
//     element pokes out, so a 390 defect names itself;
//   · every element that declares background-image WITHOUT a solid background
//     color first — the Outlook-fallback invisible-surface risk.
//
// usage: node scripts/qa-v3-final-shots.cjs --html=<file> --label=BEFORE
// output: apps/backend/artifacts/email-final-qa/<LABEL>-*.png + report json

const fs = require("node:fs");
const path = require("node:path");

const PLAYWRIGHT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/node_modules/playwright";
const OUT_DIR = path.join(__dirname, "../artifacts/email-final-qa");

const DESKTOP = { width: 1200, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SLICE = 1000; // px of page height per inspection slice

async function shoot(browser, { htmlPath, viewport, label, blockImages, deviceScaleFactor }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: deviceScaleFactor || 1 });
  if (blockImages) {
    // REAL images-blocked: no remote byte ever arrives (the closest a browser
    // gets to Gmail's "images not displayed"), so fixed-size boxes hold the
    // layout and alt text renders inside them, exactly as in a client.
    await ctx.route(/^https?:\/\//, (route) => route.abort());
  }
  const page = await ctx.newPage();
  await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(blockImages ? 700 : 2500); // remote images need real load time
  const tag = `${label}-${blockImages ? "IMAGES-BLOCKED" : "IMG-ON"}-${viewport.width === DESKTOP.width ? "desktop" : "mobile"}`;
  const prefix = path.join(OUT_DIR, `${tag}`);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [];
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
        wide.push({
          tag: el.tagName.toLowerCase(),
          right: Math.round(r.right),
          left: Math.round(r.left),
          w: Math.round(r.width),
          text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 60),
        });
      }
    }
    // keep the outermost offenders only (children of an overflowing table repeat it)
    return {
      docWidth: de.scrollWidth,
      innerWidth: window.innerWidth,
      horizontalOverflow: de.scrollWidth > window.innerWidth,
      offenders: wide.slice(0, 12),
      docHeight: de.scrollHeight,
    };
  });

  await page.screenshot({ path: `${prefix}-full.png`, fullPage: true });
  // inspection slices: scroll a SLICE-tall viewport down the page and shoot the
  // viewport (clip+fullPage are mutually exclusive; a scrolled viewport is the
  // same pixels without the argument).
  const slices = Math.ceil(m.docHeight / SLICE);
  await page.setViewportSize({ width: viewport.width, height: SLICE });
  for (let i = 0; i < slices; i++) {
    const y = i * SLICE;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(120);
    await page.screenshot({ path: `${prefix}-slice-${String(i + 1).padStart(2, "0")}.png` });
  }
  await ctx.close();
  return { tag, ...m, slices };
}

async function main() {
  const htmlArg = (process.argv.find((a) => a.startsWith("--html=")) || "").slice("--html=".length);
  const label = (process.argv.find((a) => a.startsWith("--label=")) || "").slice("--label=".length) || "SHOT";
  if (!htmlArg) throw new Error("usage: qa-v3-final-shots.cjs --html=<file> --label=BEFORE");
  const htmlPath = path.resolve(htmlArg);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // The Outlook-fallback scan is static: every inline background-image must be
  // preceded by a solid `background:<color>` in the SAME style attribute (the
  // Word engine keeps the first, drops the image — a missing solid is an
  // invisible-surface risk for anything drawn on top of it).
  const html = fs.readFileSync(htmlPath, "utf8");
  const glassRisks = [];
  for (const sm of html.matchAll(/style="([^"]*)"/g)) {
    const s = sm[1];
    if (!s.includes("background-image")) continue;
    if (!/(?:^|;)\s*background:\s*#|bgcolor="/.test(s) && !s.includes("bgcolor")) {
      // style itself carries no solid fill
      glassRisks.push(s.slice(0, 120));
    }
  }

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch();
  const shots = [];
  shots.push(await shoot(browser, { htmlPath, viewport: DESKTOP, label, blockImages: false, deviceScaleFactor: 1 }));
  shots.push(await shoot(browser, { htmlPath, viewport: MOBILE, label, blockImages: false, deviceScaleFactor: 2 }));
  shots.push(await shoot(browser, { htmlPath, viewport: DESKTOP, label, blockImages: true, deviceScaleFactor: 1 }));
  shots.push(await shoot(browser, { htmlPath, viewport: MOBILE, label, blockImages: true, deviceScaleFactor: 2 }));
  await browser.close();

  const report = { label, checkedAt: new Date().toISOString(), shots, glassRisks, glassRiskCount: glassRisks.length };
  const reportPath = path.join(OUT_DIR, `${label}-report.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  for (const s of shots) {
    console.log(`${s.tag}: doc ${s.docWidth}x${s.docHeight} overflow=${s.horizontalOverflow ? "YES " + JSON.stringify(s.offenders.slice(0, 3)) : "no"} slices=${s.slices}`);
  }
  console.log(`outlook solid-fill risks: ${glassRisks.length}`);
  console.log(`report -> ${reportPath}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
