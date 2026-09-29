"use strict";
// scripts/check-email-fold.cjs
// -----------------------------------------------------------------------------
// Does the FIRST SCREENFUL actually carry the value?
//
// Renders the assembled email at a real phone viewport (390x844) and measures
// where each load-bearing block lands, in pixels, from the top of the document.
// "It looks fine" is not evidence; a bounding rect is.
//
// It also runs the two tests that catch the failure modes email specifically has:
//   · IMAGES OFF — many clients block remote images and some strip CID too.
//     The email must still read. We re-render with every <img> suppressed and
//     dump the visible text so a human can confirm it still makes sense.
//   · HORIZONTAL OVERFLOW — a single fixed-width cell wider than 390px turns the
//     whole message into a sideways-scrolling mess.
//
// Outputs a screenshot of the fold ONLY (clipped at exactly 844px) so there is
// no way to accidentally judge the fold by looking at content below it.
// -----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const PLAYWRIGHT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/node_modules/playwright";
const ART = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa";
const SHOT_DIR = path.join(ART, "email-shots");

const PHONE = { width: 390, height: 844 };

// The blocks that have to be above the fold, located by the text they render.
const BLOCKS = [
  { id: "opener", needle: "Fort Worth, TX", must: true },
  { id: "visual_before", selector: 'img[alt*="current"]', must: true },
  { id: "visual_after", selector: 'img[alt*="new"]', must: true },
  { id: "cta_see_site", needle: "See your live site", must: true },
  { id: "signal_grade", needle: "Your Signal report is ready", must: true },
  { id: "signal_rivals", needle: "local roofers, by name", must: true },
  { id: "signal_button", needle: "Open your Signal report", must: true },
  { id: "feature_rail", needle: "included — no extra charge", must: true },
  // The tail of the 15-chip rail is allowed below the fold: a scan-list still
  // reads as "there is a lot in this" from its first half. Reported, not required.
  { id: "feature_last", needle: "Riley", must: false },
];

async function main() {
  const key = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "ramon";
  const file = path.join(SHOT_DIR, `final-${key}.html`);
  if (!fs.existsSync(file)) throw new Error(`no preview at ${file} — run send-final-outreach.cjs --dry-run first`);

  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("file:///" + file.replace(/\\/g, "/"), { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(600);

  const measured = [];
  for (const b of BLOCKS) {
    const r = await page.evaluate(({ needle, selector }) => {
      let el = null;
      if (selector) el = document.querySelector(selector);
      else {
        const walk = document.evaluate(
          `//*[not(self::script or self::style)][contains(normalize-space(.), ${JSON.stringify(needle)})]`,
          document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
        );
        // deepest match = the element that actually renders the text
        for (let i = walk.snapshotLength - 1; i >= 0; i--) {
          const c = walk.snapshotItem(i);
          if (c.getBoundingClientRect().height > 0) { el = c; break; }
        }
      }
      if (!el) return null;
      const q = el.getBoundingClientRect();
      return { top: Math.round(q.top + window.scrollY), bottom: Math.round(q.bottom + window.scrollY), h: Math.round(q.height), w: Math.round(q.width) };
    }, b);
    measured.push({ ...b, rect: r, aboveFold: r ? r.top < PHONE.height : false, fullyAboveFold: r ? r.bottom <= PHONE.height : false });
  }

  const page_ = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    docWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    images: [...document.images].map((i) => ({ alt: i.alt, w: i.naturalWidth, h: i.naturalHeight, broken: i.naturalWidth === 0 })),
    links: [...document.querySelectorAll("a[href]")].length,
  }));

  // Tap targets above the fold must be finger-sized.
  const smallTaps = await page.evaluate((foldH) => {
    const out = [];
    for (const a of document.querySelectorAll("a[href]")) {
      const r = a.getBoundingClientRect();
      if (r.height <= 0 || r.top + window.scrollY > foldH) continue;
      if (r.height < 44) out.push({ text: (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 46), h: Math.round(r.height) });
    }
    return out;
  }, PHONE.height);

  // --- the fold screenshot: clipped at EXACTLY the viewport height.
  const foldShot = path.join(SHOT_DIR, `fold-${key}-390x844.png`);
  await page.screenshot({ path: foldShot, clip: { x: 0, y: 0, width: PHONE.width, height: PHONE.height } });

  const fullShot = path.join(SHOT_DIR, `full-${key}-390.png`);
  await page.screenshot({ path: fullShot, fullPage: true });

  // --- IMAGES OFF. Does it still read?
  await page.evaluate(() => {
    for (const i of [...document.images]) {
      const alt = document.createElement("span");
      alt.textContent = `[IMAGE: ${i.alt}]`;
      alt.setAttribute("style", "display:block;border:1px dashed #bbb;padding:6px;font:11px sans-serif;color:#666");
      i.replaceWith(alt);
    }
  });
  await page.waitForTimeout(300);
  const noImgText = await page.evaluate(() => document.body.innerText.replace(/\n{3,}/g, "\n\n"));
  const noImgShot = path.join(SHOT_DIR, `fold-${key}-images-off.png`);
  await page.screenshot({ path: noImgShot, clip: { x: 0, y: 0, width: PHONE.width, height: PHONE.height } });

  await browser.close();

  const htmlKB = Number((fs.statSync(file).size / 1024).toFixed(1));
  const missing = measured.filter((m) => m.must && !m.aboveFold);
  const report = {
    checkedAt: new Date().toISOString(),
    key,
    viewport: PHONE,
    htmlKB,
    docHeight: page_.docHeight,
    horizontalOverflow: page_.docWidth > page_.innerWidth,
    docWidth: page_.docWidth,
    brokenImages: page_.images.filter((i) => i.broken),
    imageCount: page_.images.length,
    linkCount: page_.links,
    blocks: measured,
    smallTapTargetsAboveFold: smallTaps,
    foldScreenshot: foldShot,
    fullScreenshot: fullShot,
    imagesOffScreenshot: noImgShot,
    imagesOffText: noImgText,
    pass: missing.length === 0 && page_.docWidth <= page_.innerWidth && page_.images.every((i) => !i.broken),
    missingAboveFold: missing.map((m) => m.id),
  };

  fs.writeFileSync(path.join(ART, "final-email-fold-check.json"), JSON.stringify(report, null, 2) + "\n");

  console.log(`viewport 390x844 · doc ${page_.docWidth}x${page_.docHeight} · html ${htmlKB}KB`);
  console.log(`horizontal overflow: ${report.horizontalOverflow ? "!! YES" : "no"}   broken images: ${report.brokenImages.length}`);
  console.log("");
  console.log("BLOCK                 top   bottom   above fold?");
  for (const m of measured) {
    const r = m.rect;
    const state = !r ? "NOT FOUND" : m.fullyAboveFold ? "yes (fully)" : m.aboveFold ? "starts above, runs past" : "NO — below fold";
    console.log(`  ${m.id.padEnd(18)} ${String(r ? r.top : "-").padStart(5)} ${String(r ? r.bottom : "-").padStart(8)}   ${state}${m.must && !m.aboveFold ? "   <<< REQUIRED" : ""}`);
  }
  console.log("");
  if (smallTaps.length) {
    console.log(`!! ${smallTaps.length} tap target(s) above the fold under 44px:`);
    for (const t of smallTaps) console.log(`   ${t.h}px  "${t.text}"`);
  } else {
    console.log("all above-fold tap targets >= 44px");
  }
  console.log("");
  console.log(`fold screenshot -> ${foldShot}`);
  console.log(`images-off      -> ${noImgShot}`);
  console.log(`VERDICT: ${report.pass ? "PASS" : "FAIL — " + report.missingAboveFold.join(", ")}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
