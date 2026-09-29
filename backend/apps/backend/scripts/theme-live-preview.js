"use strict";

// scripts/theme-live-preview.js — the theme, applied to a REAL hydrated mirror.
//
// The donor dist cannot be rendered on its own: it is an unhydrated template
// whose React app never mounts (its index.html still carries [[NEED:SITE_URL]]
// and the {{TOKEN}} substitution has not run). Serving it proves nothing.
//
// So take the LIVE mirror — already hydrated, already deployed, the exact page
// the owner is looking at — and intercept its stylesheet and its HTML on the
// way into the browser, applying precisely what lib/mirror-engine/theme.js
// would have written at build time. What renders is what the next build will
// look like.
//
//   node scripts/theme-live-preview.js https://wss-test-....wss-ai.com/ --accent "#C53F34"

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const theme = require("../lib/mirror-engine/theme");
const { decodePngToRgba } = require("../lib/png-decode");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const URL_ARG = process.argv[2];
if (!URL_ARG) { console.error("usage: node scripts/theme-live-preview.js <live-mirror-url> [--accent #RRGGBB] [--mode light|dark] [--vertical hvac]"); process.exit(1); }

const ACCENT = arg("accent", "");
const PRIMARY = arg("primary", "");
const MODE = arg("mode", "light");
const VERTICAL = arg("vertical", "hvac");
const LABEL = arg("label", new URL(URL_ARG).hostname.split(".")[0].slice(0, 40));
const OUTDIR = path.join(__dirname, "..", "artifacts", "theme-proof");

function bandStrip(png, rows = 300) {
  const img = decodePngToRgba(png);
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const out = [];
  for (let y0 = 0; y0 < img.height; y0 += rows) {
    let bright = 0, n = 0;
    for (let y = y0; y < Math.min(y0 + rows, img.height); y += 6) {
      for (let x = 0; x < img.width; x += 6) {
        const i = (y * img.width + x) * 4;
        const L = 0.2126 * f(img.data[i]) + 0.7152 * f(img.data[i + 1]) + 0.0722 * f(img.data[i + 2]);
        if (L >= 0.5) bright++;
        n++;
      }
    }
    out.push(bright / n);
  }
  return out;
}
const strip = (b) => b.map((x) => (x >= 0.5 ? "L" : x >= 0.25 ? "-" : "D")).join("");
const lightPct = (b) => ((b.filter((x) => x >= 0.5).length / b.length) * 100).toFixed(0);

async function shoot(page, tag) {
  const fold = await page.screenshot();
  const full = await page.screenshot({ fullPage: true });
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, `${LABEL}-${tag}-fold.png`), fold);
  fs.writeFileSync(path.join(OUTDIR, `${LABEL}-${tag}-full.png`), full);
  return { fold: bandStrip(fold), full: bandStrip(full) };
}

async function main() {
  const browser = await chromium.launch();
  const out = {};

  // --- BEFORE: the live page, untouched -----------------------------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(URL_ARG, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    out.before = await shoot(page, "live-before");
    await page.close();
  }

  // --- AFTER: the same page with the theme spliced in ----------------------
  let applied = null;
  const errors = [];
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));

    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      const isCss = /\.css(\?|$)/i.test(url);
      const isDoc = req.resourceType() === "document";
      if (!isCss && !isDoc) return route.continue();

      let response;
      try { response = await route.fetch(); } catch { return route.continue(); }
      let body = await response.text();

      if (isCss) {
        const palette = theme.buildThemePair({ accent: ACCENT, primary: PRIMARY, vertical: VERTICAL, mode: MODE });
        if (!palette.passes) throw new Error(`palette failed: ${palette.contrastFailures}`);
        applied = {
          palette,
          slabs: theme.darkSurfaceSelectors(body),
          auroras: theme.auroraSelectors(body),
        };
        body += "\n" + theme.themeCss({ palette, donorCss: body, defaultMode: MODE });
      } else if (isDoc) {
        if (/<\/head>/i.test(body)) body = body.replace(/<\/head>/i, `${theme.themeBootScript(MODE)}\n</head>`);
        if (/<\/body>/i.test(body)) body = body.replace(/<\/body>/i, `${theme.themeToggleHtml()}\n</body>`);
      }
      return route.fulfill({ response, body });
    });

    await page.goto(URL_ARG, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    out.after = await shoot(page, "live-after");

    // The toggle: present, clickable, remembered.
    const toggle = await page.$("[data-wss-theme-toggle]");
    out.toggle = { present: !!toggle };
    if (toggle) {
      out.toggle.before = await page.getAttribute("html", theme.THEME_ATTR);
      await toggle.click();
      await page.waitForTimeout(800);
      out.toggle.after = await page.getAttribute("html", theme.THEME_ATTR);
      out.toggle.stored = await page.evaluate("localStorage.getItem('wss-theme')");
      out.toggled = await shoot(page, "live-after-toggled");
    }

    // Contrast where a human actually reads: sample real body copy in the DOM,
    // IN BOTH THEMES. Checking only the default missed a whole class of defect:
    // the header wordmark, the active nav item and the phone number are all
    // `text-primary`, which stayed the donor's dark navy and rendered
    // dark-on-dark the moment anyone pressed the toggle.
    out.domContrast = {};
    for (const mode of ["light", "dark"]) {
      await page.evaluate(`document.documentElement.setAttribute("${theme.THEME_ATTR}","${mode}")`);
      await page.waitForTimeout(500);
      out.domContrast[mode] = await measureContrast(page);
    }
    await page.evaluate(`document.documentElement.setAttribute("${theme.THEME_ATTR}","${MODE}")`);
    await page.close();
  }
  await browser.close();

  report(out, applied, errors);
}

async function measureContrast(page) {
  return page.evaluate(`(() => {
      const parse = (c) => {
        const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)\\s*(?:[,/]\\s*([\\d.]+))?/.exec(c || "");
        return m ? { r:+m[1], g:+m[2], b:+m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
      };
      const lumRgb = (c) => {
        const f = (v) => { const x = v/255; return x <= 0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055, 2.4); };
        return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
      };
      // COMPOSITE, do not look through.
      //
      // The first version skipped any ancestor with alpha < 0.9 and kept
      // climbing. That reported OUR OWN signup floater — a deliberately dark
      // glass panel, rgba(15,15,17,.72), carrying #f2f2f2 text — as 1.09:1,
      // because it compared the panel's light text against the white PAGE
      // behind the panel. Five of the eleven "failures" in the first run were
      // that one artifact. Stacking translucent layers the way the compositor
      // does is the only reading that matches what a person sees.
      const bgOf = (el) => {
        const stack = [];
        for (let n = el; n; n = n.parentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (!c || c.a === 0) continue;
          stack.push(c);
          if (c.a >= 0.999) break;
        }
        let out = { r: 255, g: 255, b: 255 };
        for (let i = stack.length - 1; i >= 0; i--) {
          const c = stack[i];
          out = { r: c.r*c.a + out.r*(1-c.a), g: c.g*c.a + out.g*(1-c.a), b: c.b*c.a + out.b*(1-c.a) };
        }
        return out;
      };
      const rows = [];
      for (const el of document.querySelectorAll("p, li, h1, h2, h3, span, a")) {
        const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(" ").trim();
        if (t.length < 25) continue;
        const cs = getComputedStyle(el);
        const fgc = parse(cs.color);
        if (!fgc) continue;
        const bgc = bgOf(el);
        // Text can be translucent too; composite it over its own background.
        const fgOver = { r: fgc.r*fgc.a + bgc.r*(1-fgc.a), g: fgc.g*fgc.a + bgc.g*(1-fgc.a), b: fgc.b*fgc.a + bgc.b*(1-fgc.a) };
        const fg = lumRgb(fgOver), bg = lumRgb(bgc);
        const hi = Math.max(fg, bg), lo = Math.min(fg, bg);
        const ratio = (hi + 0.05) / (lo + 0.05);
        rows.push({
          ratio: +ratio.toFixed(2),
          size: parseFloat(cs.fontSize),
          text: t.slice(0, 44),
          // The class list is the actionable part: a ratio tells you something
          // is wrong, the class tells you which rule to write.
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 150),
          color: cs.color,
          clip: cs.webkitBackgroundClip || cs.backgroundClip,
        });
      }
      rows.sort((a, b) => a.ratio - b.ratio);
      // PAINTED GLYPHS ARE NOT MEASURABLE THIS WAY. A node with
      // color:transparent is drawn by a background-clip:text gradient or a
      // -webkit-text-stroke, so its computed color says nothing about what
      // the eye receives and always scores 1:1. Counting those as failures
      // buries the real ones; ignoring them silently would hide a genuine
      // regression. So they are separated and still reported.
      const painted = rows.filter(r => /rgba\\(0, 0, 0, 0\\)|transparent/.test(r.color));
      const measurable = rows.filter(r => !painted.includes(r));
      const body = measurable.filter(r => r.size < 24);
      return {
        sampled: rows.length,
        worst: body.filter(r => r.ratio < 4.5).slice(0, 8),
        bodyBelow45: body.filter(r => r.ratio < 4.5).length,
        bodySampled: body.length,
        paintedGlyphs: painted.map(r => ({ size: r.size, cls: r.cls.slice(0, 60), text: r.text })),
      };
    })()`);
}

function report(out, applied, errors) {
  console.log(`live mirror   ${URL_ARG}`);
  if (applied) {
    console.log(`accent        ${applied.palette.accent}  (${applied.palette.source}${applied.palette.fallbackName ? " / " + applied.palette.fallbackName : ""})`);
    console.log(`palette       surface=${applied.palette.surface} slab=${applied.palette.slab} text=${applied.palette.text}`);
    console.log(`dark slabs    ${applied.slabs.arbitrary.length} arbitrary + [${applied.slabs.tokens.join(",")}]`);
    console.log(`motion        ${applied.auroras.join(", ") || "none"}`);
    console.log(`contrast      ${JSON.stringify(applied.palette.contrast)}`);
  }
  console.log(`\nFULL PAGE, 300px bands (L light / - mixed / D dark)`);
  console.log(`  before  ${strip(out.before.full)}   ${lightPct(out.before.full)}% light`);
  console.log(`  after   ${strip(out.after.full)}   ${lightPct(out.after.full)}% light`);
  if (out.toggled) console.log(`  toggled ${strip(out.toggled.full)}   ${lightPct(out.toggled.full)}% light`);
  console.log(`\nFIRST SCREENFUL   before ${lightPct(out.before.fold)}% light   after ${lightPct(out.after.fold)}% light`);
  console.log(`toggle        ${JSON.stringify(out.toggle)}`);
  console.log(`page errors   ${JSON.stringify(errors)}`);
  for (const mode of ["light", "dark"]) {
    const d = out.domContrast[mode];
    if (!d) continue;
    console.log(`\nDOM CONTRAST at real text nodes — ${mode.toUpperCase()} theme`);
    console.log(`  sampled ${d.sampled}, body-size nodes below 4.5:1 => ${d.bodyBelow45} / ${d.bodySampled}`
      + (d.bodyBelow45 ? "" : "   (clean)"));
    console.log(`  painted glyphs (gradient/stroke, not measurable from computed color): ${d.paintedGlyphs.length}`);
    for (const w of d.worst) {
      console.log(`    ${String(w.ratio).padStart(6)}:1  ${String(Math.round(w.size)).padStart(3)}px  ${w.text}`);
      console.log(`             color=${w.color}  class="${w.cls}"`);
    }
  }
  console.log(`\nshots in ${OUTDIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
