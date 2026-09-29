"use strict";
// scripts/shot-v3-mock.cjs — screenshot a rendered mock email HTML at desktop
// and phone widths, plus an images-blocked desktop pass (what a Gmail "no
// images" reader gets). NOTHING IS SENT. Uses the lane's playwright install.
//
//   node scripts/shot-v3-mock.cjs --html=<file> --out-dir=<dir> --prefix=<name>

const fs = require("node:fs");
const path = require("node:path");

const PLAYWRIGHT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/node_modules/playwright";

async function main() {
  const arg = (name, def) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.slice(name.length + 3) : def;
  };
  const htmlFile = path.resolve(arg("html", "../mock-v3-polished.html"));
  const outDir = path.resolve(arg("out-dir", "../mock-shots"));
  const prefix = arg("prefix", "v3-polished");
  const html = fs.readFileSync(htmlFile, "utf8");

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true });
  fs.mkdirSync(outDir, { recursive: true });

  // THE FLAG SHIPS WITH THE BRANCH, NOT WITH THE LAST DEPLOY (final polish,
  // 2026-09-03). /brand/us-flag.png is committed in public/brand/ but 404s on
  // ghost.wss-ai.com until this branch deploys. The shots must show the real
  // graphic, so the identical committed bytes are served from the repo when
  // production has not caught up. The HTML keeps the production URL.
  const localFlag = path.join(__dirname, "../public/brand/us-flag.png");
  const flagRoute = async (ctx) => ctx.route("**/brand/us-flag.png", async (route) => {
    try {
      const body = fs.readFileSync(localFlag);
      return route.fulfill({ status: 200, contentType: "image/png", body });
    } catch { return route.continue(); }
  });

  const shots = [
    { name: `${prefix}-desktop.png`, width: 720, height: 1200, images: true },
    { name: `${prefix}-mobile.png`, width: 390, height: 844, images: true },
    { name: `${prefix}-desktop-noimg.png`, width: 720, height: 1200, images: false },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: 2,
    });
    await flagRoute(ctx);
    // Route image requests to nothing when asked — the images-blocked view.
    if (!s.images) await ctx.route(/\.jpg|\.png|\.gif/, (r) => r.abort());
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, s.name), fullPage: true });
    console.log(`${s.name} -> ${path.join(outDir, s.name)}`);
    await ctx.close();
  }
  await browser.close();
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
