"use strict";

// scripts/trace-dark-section-contents.js — CAN a dark band be flipped to light?
//
// Knowing that the hero is `bg-[hsl(215_65%_8%)]` is only half an answer. The
// other half decides whether this is an engine fix or a donor fix: everything
// INSIDE that band was coloured for a dark surface. Light-on-dark text, hairline
// borders at white/10, glass panels at white/5. Flip the surface and every one
// of those becomes invisible.
//
// So enumerate them. For each large dark region, report the distinct text
// colours weighted by how much text wears them, the border colours, and the
// translucent-white fills. If that set is small and systematic, the engine can
// remap it. If it is a long tail of bespoke values, it is a donor change.

const { chromium } = require("playwright");

const URL_ARG = process.argv[2];
if (!URL_ARG) { console.error("usage: node scripts/trace-dark-section-contents.js <url>"); process.exit(1); }

const TRACE = `() => {
  const lumOf = (c) => {
    const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)\\s*(?:[,/]\\s*([\\d.]+))?/i.exec(c || "");
    if (!m) return null;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return { L: 0.2126 * f(+m[1]) + 0.7152 * f(+m[2]) + 0.0722 * f(+m[3]), a };
  };
  const pageArea = document.documentElement.scrollWidth * document.documentElement.scrollHeight;

  const roots = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < pageArea * 0.025) continue;
    const cs = getComputedStyle(el);
    const bg = lumOf(cs.backgroundColor);
    if (!bg || bg.a < 0.9 || bg.L > 0.18) continue;
    // Only the OUTERMOST dark box of a stack — nested dark children repeat it.
    if (roots.some((x) => x.el.contains(el))) continue;
    roots.push({ el, bg: cs.backgroundColor, L: bg.L, cls: (typeof el.className === "string" ? el.className : "").slice(0, 120) });
  }

  return roots.map((root) => {
    const text = new Map();     // colour -> characters
    const borders = new Map();  // colour -> element count
    const fills = new Map();    // translucent bg -> element count
    for (const el of root.el.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
      if (own.length > 1) text.set(cs.color, (text.get(cs.color) || 0) + own.length);
      for (const side of ["borderTopColor", "borderBottomColor", "borderLeftColor", "borderRightColor"]) {
        const w = parseFloat(cs[side.replace("Color", "Width")]);
        if (w > 0) { const c = cs[side]; const l = lumOf(c); if (l && l.a > 0.02) borders.set(c, (borders.get(c) || 0) + 1); }
      }
      const b = lumOf(cs.backgroundColor);
      if (b && b.a > 0.02 && b.a < 0.9) fills.set(cs.backgroundColor, (fills.get(cs.backgroundColor) || 0) + 1);
    }
    const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + "  x" + v);
    return {
      surface: root.bg, L: +root.L.toFixed(4), cls: root.cls,
      textColours: rank(text), borderColours: rank(borders), translucentFills: rank(fills),
      distinctText: text.size, distinctBorder: borders.size, distinctFill: fills.size,
    };
  });
}`;

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL_ARG, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  const bands = await page.evaluate(eval(`(${TRACE})`));
  await browser.close();

  console.log(`${URL_ARG}\n${bands.length} outermost dark bands >2.5% of page\n`);
  for (const b of bands) {
    console.log(`SURFACE ${b.surface}  (L=${b.L})`);
    console.log(`  class      ${b.cls}`);
    console.log(`  text       ${b.distinctText} distinct: ${b.textColours.join(" | ")}`);
    console.log(`  borders    ${b.distinctBorder} distinct: ${b.borderColours.join(" | ")}`);
    console.log(`  transl.bg  ${b.distinctFill} distinct: ${b.translucentFills.join(" | ")}`);
    console.log("");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
