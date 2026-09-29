"use strict";
/**
 * scripts/trace-surface-tint.js — WHY IS THE PAPER PINK?
 *
 * theme.js promises a surface "never below 97% lightness, 4% saturation". The
 * live Gunther and Cardinal mirrors measure #ffeae6 / #ffe9e6 — h≈9, s=100%,
 * l≈95%. Both statements cannot be true, so something other than the surface
 * token is painting the page. This finds it: it reads the resolved custom
 * properties, then walks every full-bleed element under the fold and reports
 * its own painted background, so the tinting layer names itself.
 *
 *   node scripts/trace-surface-tint.js <url> [--mode dark]
 */

const { chromium } = require("playwright");

const URL = process.argv[2];
const MODE = process.argv.includes("--mode") ? process.argv[process.argv.indexOf("--mode") + 1] : "";
if (!URL) { console.error("usage: node scripts/trace-surface-tint.js <url>"); process.exit(2); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  if (MODE) {
    await page.evaluate((m) => document.documentElement.setAttribute("data-wss-theme", m), MODE);
  }
  await page.waitForTimeout(3500);

  const out = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const name of [
      "--background", "--foreground", "--primary", "--primary-foreground", "--secondary",
      "--muted", "--border", "--accent", "--card",
      "--wss-surface", "--wss-slab", "--wss-text", "--wss-accent", "--wss-wash",
      "--gradient-mesh",
    ]) {
      const v = cs.getPropertyValue(name).trim();
      if (v) vars[name] = v;
    }

    const paint = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < window.innerWidth * 0.7 || r.height < 120) continue;
      const s = getComputedStyle(el);
      const bg = s.backgroundColor;
      const img = s.backgroundImage;
      const opaque = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      const hasImg = img && img !== "none";
      if (!opaque && !hasImg) continue;
      const key = `${el.tagName}.${el.className}`.slice(0, 90);
      if (seen.has(key)) continue;
      seen.add(key);
      paint.push({
        el: key,
        top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width),
        bg: opaque ? bg : "",
        image: hasImg ? String(img).slice(0, 150) : "",
        opacity: s.opacity,
      });
      if (paint.length >= 22) break;
    }

    const body = getComputedStyle(document.body);
    return {
      theme: document.documentElement.getAttribute("data-wss-theme"),
      vars,
      bodyBg: body.backgroundColor,
      bodyImage: String(body.backgroundImage).slice(0, 200),
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      paint,
    };
  });

  console.log(`theme attribute: ${out.theme}`);
  console.log(`html bg: ${out.htmlBg}`);
  console.log(`body bg: ${out.bodyBg}`);
  console.log(`body background-image: ${out.bodyImage}`);
  console.log(`\ncustom properties:`);
  for (const [k, v] of Object.entries(out.vars)) console.log(`  ${k.padEnd(22)} ${v}`);
  console.log(`\nfull-bleed painted layers, top to bottom:`);
  for (const p of out.paint) {
    console.log(`  y=${String(p.top).padStart(6)} h=${String(p.h).padStart(5)} op=${p.opacity}  ${p.bg.padEnd(26)} ${p.el}`);
    if (p.image) console.log(`         image: ${p.image}`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
