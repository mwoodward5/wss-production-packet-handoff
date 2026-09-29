"use strict";

// lib/wss-connect-assets/render-funnel.js — renders the funnel markup to the
// committed PNG. Run from apps/backend:
//
//   node lib/wss-connect-assets/render-funnel.js
//
// Writes public/brand/connect-funnel.png at @2x (1120px wide for a 560px
// display size) with a transparent background. Playwright chromium is already
// a dependency of this app (lib/serverless-chromium.js, proof shots).

const path = require("node:path");
const fs = require("node:fs");
const { buildConnectFunnelPage, CONNECT_FUNNEL_WIDTH, CONNECT_FUNNEL_HEIGHT } = require("./funnel-html");

const OUT_PATH = path.join(__dirname, "..", "..", "public", "brand", "connect-funnel.png");

async function renderConnectFunnel({ outPath = OUT_PATH } = {}) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: CONNECT_FUNNEL_WIDTH + 40, height: CONNECT_FUNNEL_HEIGHT + 40 },
      deviceScaleFactor: 2,
    });
    // networkidle so the Google Fonts css/woff2 have a chance to land; the
    // fonts.ready await below is what actually guarantees glyphs are drawn
    // with the loaded face rather than a fallback mid-swap.
    await page.setContent(buildConnectFunnelPage(), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.locator("#stage").screenshot({ path: outPath, omitBackground: true });
    return outPath;
  } finally {
    await browser.close();
  }
}

module.exports = { OUT_PATH, renderConnectFunnel };

if (require.main === module) {
  renderConnectFunnel()
    .then((outPath) => {
      const bytes = fs.statSync(outPath).size;
      process.stdout.write(`rendered ${outPath} (${bytes} bytes)\n`);
    })
    .catch((error) => {
      process.stderr.write(`render failed: ${error?.stack || error}\n`);
      process.exitCode = 1;
    });
}
