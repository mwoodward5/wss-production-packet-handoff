"use strict";

// scripts/trace-dark-surfaces.js — WHICH RULE paints a mirror dark?
//
// The fleet measurement proved the mirrors are dark where the clients are
// light. This answers the next question, which is the only one that decides
// where the fix belongs: is the dark surface coming from a TOKEN the engine
// can rewrite, or is it hardcoded in the donor's compiled bundle?
//
// For every large dark region on the page it reports the element, the class
// list, and the CSS custom properties in scope — so a dark band either traces
// to `--background` (engine's problem) or to a literal (donor's problem).

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const URL_ARG = process.argv[2];
if (!URL_ARG) {
  console.error("usage: node scripts/trace-dark-surfaces.js <url> [--shot out.png]");
  process.exit(1);
}
const SHOT = process.argv.includes("--shot") ? process.argv[process.argv.indexOf("--shot") + 1] : null;

const TRACE = `() => {
  const lum = (c) => {
    const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)\\s*(?:[,/]\\s*([\\d.]+))?/i.exec(c || "");
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (a < 0.5) return null;
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return { L: 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]), css: c, alpha: a };
  };
  const pageArea = document.documentElement.scrollWidth * document.documentElement.scrollHeight;
  const dark = [];
  for (const el of document.querySelectorAll("body, body *")) {
    const r = el.getBoundingClientRect();
    const area = r.width * (r.height || 0);
    if (area < pageArea * 0.02) continue;
    const cs = getComputedStyle(el);
    const bg = lum(cs.backgroundColor);
    const hasImg = cs.backgroundImage && cs.backgroundImage !== "none";
    if (!bg || bg.L > 0.18) {
      // A dark GRADIENT counts too — that is how the blurry motion is painted.
      if (!hasImg || !/gradient/i.test(cs.backgroundImage)) continue;
    }
    dark.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 220),
      areaShare: +(area / pageArea).toFixed(3),
      rect: { y: Math.round(r.y + scrollY), h: Math.round(r.height) },
      bg: cs.backgroundColor,
      bgLum: bg ? +bg.L.toFixed(4) : null,
      bgImage: hasImg ? cs.backgroundImage.slice(0, 260) : "",
      color: cs.color,
    });
  }
  // Every custom property the page declares, resolved on :root.
  const rootCs = getComputedStyle(document.documentElement);
  const vars = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules || []) {
      if (!rule.style) continue;
      for (const p of rule.style) {
        if (p.startsWith("--")) vars[p] = rootCs.getPropertyValue(p).trim();
      }
    }
  }
  return {
    htmlClass: document.documentElement.className,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlBg: rootCs.backgroundColor,
    colorScheme: rootCs.colorScheme,
    dark: dark.sort((a, b) => b.areaShare - a.areaShare).slice(0, 25),
    vars,
    // Does anything in the page even LISTEN for a theme?
    themeHooks: {
      darkClassRules: [...document.styleSheets].reduce((n, s) => {
        let r; try { r = s.cssRules; } catch { return n; }
        return n + [...(r || [])].filter((x) => x.selectorText && /\\.dark\\b/.test(x.selectorText)).length;
      }, 0),
      prefersRules: [...document.styleSheets].reduce((n, s) => {
        let r; try { r = s.cssRules; } catch { return n; }
        return n + [...(r || [])].filter((x) => x.conditionText && /prefers-color-scheme/.test(x.conditionText)).length;
      }, 0),
    },
  };
}`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL_ARG, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  const out = await page.evaluate(eval(`(${TRACE})`));
  if (SHOT) {
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    await page.screenshot({ path: SHOT, fullPage: true });
  }
  await browser.close();

  console.log(`URL           ${URL_ARG}`);
  console.log(`html class    ${JSON.stringify(out.htmlClass)}`);
  console.log(`html bg       ${out.htmlBg}`);
  console.log(`body bg       ${out.bodyBg}`);
  console.log(`color-scheme  ${out.colorScheme}`);
  console.log(`.dark rules   ${out.themeHooks.darkClassRules}`);
  console.log(`prefers rules ${out.themeHooks.prefersRules}`);
  console.log("\n--- DARK REGIONS (>2% of page area), largest first ---");
  for (const d of out.dark) {
    console.log(
      `${String(d.areaShare).padStart(6)}  y=${String(d.rect.y).padStart(6)} h=${String(d.rect.h).padStart(5)}  ` +
      `${d.tag}${d.id ? "#" + d.id : ""}  bg=${d.bg} L=${d.bgLum}\n` +
      `         class="${d.cls}"` + (d.bgImage ? `\n         bg-image=${d.bgImage}` : ""),
    );
  }
  const interesting = Object.entries(out.vars)
    .filter(([k]) => /background|foreground|surface|card|muted|border|accent|primary|secondary|popover|input|ring/i.test(k))
    .sort();
  console.log("\n--- THEME CUSTOM PROPERTIES ON :root ---");
  for (const [k, v] of interesting) console.log(`  ${k.padEnd(28)} ${v}`);
  console.log(`\n(total custom properties seen: ${Object.keys(out.vars).length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
