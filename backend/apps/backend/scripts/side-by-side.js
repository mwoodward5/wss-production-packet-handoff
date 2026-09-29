"use strict";
// scripts/side-by-side.js — their real site next to our mirror, at the two
// widths a human actually looks at, plus the hero legibility measured rather
// than admired.
//
// WHY THE FOLD IS CAPTURED SEPARATELY FROM THE FULL PAGE. A visitor decides
// whether a site belongs to a business in the first screen. A full-page
// screenshot of a 12,000px marketing page averages that screen away — the same
// mistake scripts/design-diff.js made when a whole-page histogram called a
// dark-hero mirror "light" because of the white footer under it.
//
// HERO LEGIBILITY IS MEASURED, NOT EYEBALLED. For every text node inside the
// hero we read the COMPUTED colour and the actual pixels behind it (a photo
// under a scrim is not a flat colour), and report the worst WCAG contrast on
// the page's first screen. A hero that now carries the client's photograph and
// has quietly stopped being readable is a regression, not a feature.
//
//   node scripts/side-by-side.js --pairs scripts/side-by-side-pairs.json
//   node scripts/side-by-side.js --ours https://x.wss-ai.com/ --name x
//
// Writes artifacts/side-by-side/<slug>/: their-fold-1280.png, our-fold-1280.png,
// their-fold-390.png, our-fold-390.png, our-full-1280.png, compare-1280.png,
// compare-390.png and measured.json.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const OUTDIR = path.join(ROOT, "artifacts", "side-by-side");

const arg = (n, d = "") => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? (process.argv[i + 1] || "true") : d;
};

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// --- contrast, the same WCAG maths lib/hero-wash.js proves its scrim with ----
const chan = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ({ r, g, b }) => 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
const ratio = (a, b) => { const hi = Math.max(a, b); const lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05); };

/**
 * Every text node in the hero, its computed colour, and the MEAN colour of the
 * pixels it sits on — sampled from the element's own painted box by drawing the
 * captured screenshot into a canvas in the page. Reading `background-color`
 * would report `transparent` for text over a photograph, which is how a hero
 * can measure perfect and be unreadable.
 */
async function heroLegibility(page) {
  return page.evaluate(() => {
    const pick = document.querySelector('[data-hero], .hero, section.hero, header.hero, main section:first-of-type, header')
      || document.body;
    const rect = pick.getBoundingClientRect();
    const out = [];
    const walker = document.createTreeWalker(pick, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let node;
    while ((node = walker.nextNode())) {
      const text = (node.textContent || "").trim();
      if (text.length < 3) continue;
      const el = node.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.15) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.top > window.innerHeight || r.bottom < 0) continue;
      const size = parseFloat(cs.fontSize) || 16;
      out.push({
        text: text.slice(0, 60), color: cs.color, fontSize: size,
        bold: Number(cs.fontWeight) >= 700,
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    return { heroBox: { w: Math.round(rect.width), h: Math.round(rect.height) }, nodes: out.slice(0, 40) };
  });
}

const parseRgb = (s) => {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(String(s || ""));
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
};

/**
 * The mean colour actually behind a box, read out of the captured PNG by
 * decoding it in a headless page. No image library is installed here and none
 * is needed: the browser already has a decoder.
 */
async function meanBehind(page, pngPath, boxes) {
  const dataUri = `data:image/png;base64,${fs.readFileSync(pngPath).toString("base64")}`;
  return page.evaluate(async ({ dataUri: uri, boxes: bs }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = uri; });
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    const ctx = c.getContext("2d");
    return bs.map((b) => {
      const x = Math.max(0, Math.min(c.width - 1, b.x));
      const y = Math.max(0, Math.min(c.height - 1, b.y));
      const w = Math.max(1, Math.min(c.width - x, b.w));
      const h = Math.max(1, Math.min(c.height - y, b.h));
      const d = ctx.getImageData(x, y, w, h).data;
      let r = 0; let g = 0; let bl = 0; let n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
      return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(bl / n) };
    });
  }, { dataUri, boxes });
}

async function shoot(ctx, url, dir, prefix, width, height, { full = false } = {}) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width, height });
  const report = { url, width, ok: false };
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); } catch { /* reported below */ }
  }
  await page.waitForTimeout(2500);
  try {
    const foldPath = path.join(dir, `${prefix}-fold-${width}.png`);
    await page.screenshot({ path: foldPath, fullPage: false });
    report.fold = foldPath;
    if (full) {
      const fullPath = path.join(dir, `${prefix}-full-${width}.png`);
      await page.screenshot({ path: fullPath, fullPage: true });
      report.full = fullPath;
    }
    report.title = await page.title();
    // The hero's text, and whether it survived whatever is now behind it.
    const hero = await heroLegibility(page);
    const boxes = hero.nodes.map((n) => n.box);
    const means = boxes.length ? await meanBehind(page, report.fold, boxes) : [];
    report.hero = hero.nodes.map((n, i) => {
      const fg = parseRgb(n.color);
      const bg = means[i];
      if (!fg || !bg) return { text: n.text, contrast: null };
      const cr = ratio(lum(fg), lum(bg));
      const large = n.fontSize >= 24 || (n.fontSize >= 18.66 && n.bold);
      return {
        text: n.text, fontSize: n.fontSize, color: n.color,
        behind: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
        contrast: Number(cr.toFixed(2)),
        requirement: large ? 3 : 4.5,
        passes: cr >= (large ? 3 : 4.5),
      };
    });
    const failures = report.hero.filter((h) => h.passes === false);
    report.hero_worst = report.hero.reduce((w, h) => (h.contrast != null && (w == null || h.contrast < w) ? h.contrast : w), null);
    report.hero_failures = failures.length;
    report.hero_failing_text = failures.slice(0, 4).map((f) => `${f.text} (${f.contrast}:1, needs ${f.requirement})`);
    // Photographs actually rendered above the fold, and how big.
    report.images = await page.evaluate(() => {
      const seen = [];
      for (const el of document.querySelectorAll("img")) {
        const r = el.getBoundingClientRect();
        if (r.top > window.innerHeight || r.width < 40 || r.height < 40) continue;
        seen.push({ src: (el.currentSrc || el.src || "").slice(-70), w: Math.round(r.width), h: Math.round(r.height) });
      }
      const bg = [];
      for (const el of document.querySelectorAll("*")) {
        const b = getComputedStyle(el).backgroundImage;
        if (!b || b === "none" || !/url\(/.test(b)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 200 || r.height < 120 || r.top > window.innerHeight) continue;
        bg.push({ src: (b.match(/url\(["']?([^"')]+)/) || [])[1]?.slice(-70) || "", w: Math.round(r.width), h: Math.round(r.height) });
      }
      return { img: seen.slice(0, 12), background: bg.slice(0, 6) };
    });
    report.ok = true;
  } catch (e) {
    report.error = String(e.message || e).slice(0, 200);
  }
  await page.close();
  return report;
}

/** Two PNGs on one canvas with labels, screenshotted — no image library needed. */
async function compose(ctx, leftPath, rightPath, outPath, { leftLabel, rightLabel, width }) {
  const page = await ctx.newPage();
  const uri = (p) => `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  const html = `<!doctype html><meta charset="utf-8"><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#0d0d10;font:600 15px/1.3 -apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8ee;padding:16px}
    .row{display:flex;gap:16px;align-items:flex-start}
    .col{flex:1;min-width:0}
    .cap{padding:8px 10px;background:#1b1b22;border-radius:6px 6px 0 0;border:1px solid #2c2c36;border-bottom:0}
    .cap small{display:block;font-weight:400;color:#9a9aa8;font-size:12px;margin-top:2px}
    img{display:block;width:100%;border:1px solid #2c2c36;border-radius:0 0 6px 6px}
  </style><div class="row">
    <div class="col"><div class="cap">THEIR SITE<small>${leftLabel}</small></div><img src="${uri(leftPath)}"></div>
    <div class="col"><div class="cap">OUR MIRROR<small>${rightLabel}</small></div><img src="${uri(rightPath)}"></div>
  </div>`;
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: outPath, fullPage: true });
  await page.close();
}

(async () => {
  const pairsArg = arg("pairs", "");
  const pairs = pairsArg
    ? JSON.parse(fs.readFileSync(path.isAbsolute(pairsArg) ? pairsArg : path.join(ROOT, pairsArg), "utf8"))
    : [{ name: arg("name", "site"), ours: arg("ours", ""), theirs: arg("theirs", "") }];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const all = [];
  for (const p of pairs) {
    const slug = slugify(p.name);
    const dir = path.join(OUTDIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    process.stderr.write(`\n== ${p.name}\n`);

    const ours1280 = await shoot(ctx, p.ours, dir, "our", 1280, 800, { full: true });
    const ours390 = await shoot(ctx, p.ours, dir, "our", 390, 844);
    process.stderr.write(`   ours  1280 hero worst contrast ${ours1280.hero_worst}:1, ${ours1280.hero_failures} failing\n`);

    let theirs1280 = null; let theirs390 = null;
    if (p.theirs) {
      theirs1280 = await shoot(ctx, p.theirs, dir, "their", 1280, 800);
      theirs390 = await shoot(ctx, p.theirs, dir, "their", 390, 844);
      if (theirs1280.fold && ours1280.fold) {
        await compose(ctx, theirs1280.fold, ours1280.fold, path.join(dir, "compare-1280.png"), {
          leftLabel: p.theirs, rightLabel: p.ours, width: 2640,
        });
      }
      if (theirs390.fold && ours390.fold) {
        await compose(ctx, theirs390.fold, ours390.fold, path.join(dir, "compare-390.png"), {
          leftLabel: p.theirs, rightLabel: p.ours, width: 880,
        });
      }
    }
    const row = { name: p.name, slug, dir, ours: { d1280: ours1280, d390: ours390 }, theirs: { d1280: theirs1280, d390: theirs390 } };
    fs.writeFileSync(path.join(dir, "measured.json"), JSON.stringify(row, null, 2));
    all.push(row);
  }
  await browser.close();

  fs.writeFileSync(path.join(OUTDIR, "measured.json"), JSON.stringify(all, null, 2));
  console.log(JSON.stringify(all.map((r) => ({
    name: r.name,
    our_title: r.ours.d1280.title,
    our_hero_worst_contrast: r.ours.d1280.hero_worst,
    our_hero_failures: r.ours.d1280.hero_failures,
    our_hero_failing_text: r.ours.d1280.hero_failing_text,
    our_fold_images: (r.ours.d1280.images?.img || []).length + (r.ours.d1280.images?.background || []).length,
    mobile_hero_worst_contrast: r.ours.d390.hero_worst,
    mobile_hero_failures: r.ours.d390.hero_failures,
  })), null, 2));
  console.log(`\nwrote ${OUTDIR}`);
})().catch((e) => { console.error(e); process.exit(1); });
