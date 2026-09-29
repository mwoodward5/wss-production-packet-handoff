"use strict";

// Throwaway probe: which SELECTORS paint the translucent dark glass cards that
// float over the hero? The stylesheet grep found nothing, so ask the DOM.

const { chromium } = require("playwright");

const URL_ARG = process.argv[2] || "https://wss-test-right-way-heating-and-cooling-columbus.wss-ai.com/";

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.goto(URL_ARG, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(3000);
  const out = await p.evaluate(`(() => {
    const res = [];
    for (const el of document.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      const m = /rgba\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)/.exec(cs.backgroundColor);
      if (!m) continue;
      const a = Number(m[4]);
      const L = (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3;
      if (a < 0.3 || a > 0.97 || L > 90) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 6000) continue;
      res.push({
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 240),
        bg: cs.backgroundColor,
        size: Math.round(r.width) + "x" + Math.round(r.height),
      });
    }
    return res.slice(0, 14);
  })()`);
  for (const r of out) console.log(`${r.bg.padEnd(26)} ${r.size.padEnd(11)} ${r.cls}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
