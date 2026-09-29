"use strict";

// scripts/theme-render-proof.js — RENDER IT, do not trust the checks.
//
// Applies lib/mirror-engine/theme.js to a real donor dist exactly the way the
// engine does, serves the result, renders it in Chromium, and measures the
// brightness of the page band by band. A passing unit test proves the CSS
// string is what we meant to write. Only this proves the browser agrees.
//
//   node scripts/theme-render-proof.js hvac-premier --accent "#C53F34"

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");

const theme = require("../lib/mirror-engine/theme");
const { decodePngToRgba } = require("../lib/png-decode");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : dflt;
};

const DONOR = process.argv[2] || "hvac-premier";
const ACCENT = arg("accent", "#C53F34");
const PRIMARY = arg("primary", "");
const MODE = arg("mode", "light");
const VERTICAL = arg("vertical", "hvac");
const OUTDIR = path.join(__dirname, "..", "artifacts", "theme-proof");

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain",
  ".xml": "application/xml", ".mp4": "video/mp4",
};

function readTree(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) readTree(full, base, out);
    else out[path.relative(base, full).split(path.sep).join("/")] = fs.readFileSync(full);
  }
  return out;
}

/** The engine's theme step, verbatim in shape so this proves the real path. */
function applyTheme(files, { accent, primary, vertical, mode }) {
  const palette = theme.buildThemePair({ accent, primary, vertical, mode });
  if (!palette.passes) throw new Error(`palette failed contrast: ${palette.contrastFailures.join(",")}`);

  const cssRels = Object.keys(files).filter((r) => /\.css$/i.test(r)).sort();
  const target = cssRels[cssRels.length - 1];
  if (!target) throw new Error("donor ships no stylesheet");
  const donorCss = files[target].toString("utf8");
  const sheet = theme.themeCss({ palette, donorCss, defaultMode: mode });
  files[target] = Buffer.from(`${donorCss}\n${sheet}`, "utf8");

  for (const rel of Object.keys(files)) {
    if (!/\.html$/i.test(rel)) continue;
    let html = files[rel].toString("utf8");
    if (/<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `${theme.themeBootScript(mode)}\n</head>`);
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${theme.themeToggleHtml()}\n</body>`);
    files[rel] = Buffer.from(html, "utf8");
  }
  return { palette, stylesheet: target, slabs: theme.darkSurfaceSelectors(donorCss), auroras: theme.auroraSelectors(donorCss) };
}

function serve(files) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "");
    if (!rel || rel.endsWith("/")) rel += "index.html";
    let buf = files[rel];
    if (!buf) { rel = "index.html"; buf = files[rel]; }        // SPA fallback
    if (!buf) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(rel)] || "application/octet-stream" });
    res.end(buf);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

function bands(png, rows = 300) {
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
    out.push({ y: y0, bright: bright / n });
  }
  return { bands: out, height: img.height };
}

async function main() {
  const donorDir = path.join(__dirname, "..", "donors-clean", DONOR);
  if (!fs.existsSync(donorDir)) throw new Error(`no donor at ${donorDir}`);
  fs.mkdirSync(OUTDIR, { recursive: true });

  // BEFORE — the donor as it ships today.
  const before = readTree(donorDir);
  const beforeSrv = await serve(before);

  // AFTER — the same tree with the theme applied.
  const after = readTree(donorDir);
  const applied = applyTheme(after, { accent: ACCENT, primary: PRIMARY, vertical: VERTICAL, mode: MODE });
  const afterSrv = await serve(after);

  console.log(`donor            ${DONOR}`);
  console.log(`accent           ${ACCENT} (${applied.palette.source})`);
  console.log(`mode             ${MODE}`);
  console.log(`stylesheet       ${applied.stylesheet}`);
  console.log(`dark slabs       ${applied.slabs.arbitrary.length} arbitrary + ${applied.slabs.tokens.length} token(s): ${applied.slabs.tokens.join(",")}`);
  console.log(`motion layers    ${applied.auroras.join(", ") || "none"}`);
  console.log(`palette          surface=${applied.palette.surface} slab=${applied.palette.slab} text=${applied.palette.text} accent=${applied.palette.accent}`);
  console.log(`contrast         ${JSON.stringify(applied.palette.contrast)}`);

  const browser = await chromium.launch();
  const results = {};
  for (const [label, srv] of [["before", beforeSrv], ["after", afterSrv]]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${srv.port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const fold = await page.screenshot();
    const full = await page.screenshot({ fullPage: true });
    fs.writeFileSync(path.join(OUTDIR, `${DONOR}-${label}-fold.png`), fold);
    fs.writeFileSync(path.join(OUTDIR, `${DONOR}-${label}-full.png`), full);
    results[label] = { fold: bands(fold), full: bands(full) };

    if (label === "after") {
      // The toggle has to be a real, clickable control that survives React.
      const toggle = await page.$("[data-wss-theme-toggle]");
      results.toggle = { present: !!toggle };
      if (toggle) {
        results.toggle.themeBefore = await page.getAttribute("html", theme.THEME_ATTR);
        await toggle.click();
        await page.waitForTimeout(600);
        results.toggle.themeAfter = await page.getAttribute("html", theme.THEME_ATTR);
        fs.writeFileSync(path.join(OUTDIR, `${DONOR}-after-toggled-fold.png`), await page.screenshot());
        results.toggle.stored = await page.evaluate("localStorage.getItem('wss-theme')");
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1500);
        results.toggle.themeAfterReload = await page.getAttribute("html", theme.THEME_ATTR);
      }
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e.message)));
      results.pageErrors = errs;
    }
    await page.close();
  }
  await browser.close();
  beforeSrv.server.close();
  afterSrv.server.close();

  const strip = (b) => b.bands.map((x) => (x.bright >= 0.5 ? "L" : x.bright >= 0.25 ? "-" : "D")).join("");
  console.log(`\nFULL PAGE, 300px bands  (L=light  -=mixed  D=dark)`);
  console.log(`  before  ${strip(results.before.full)}`);
  console.log(`  after   ${strip(results.after.full)}`);
  const pct = (b) => (b.bands.filter((x) => x.bright >= 0.5).length / b.bands.length * 100).toFixed(0);
  console.log(`\nlight bands   before ${pct(results.before.full)}%   after ${pct(results.after.full)}%`);
  console.log(`FIRST SCREENFUL bright pixels   before ${(results.before.fold.bands.reduce((s, x) => s + x.bright, 0) / results.before.fold.bands.length * 100).toFixed(0)}%`
    + `   after ${(results.after.fold.bands.reduce((s, x) => s + x.bright, 0) / results.after.fold.bands.length * 100).toFixed(0)}%`);
  console.log(`\ntoggle  ${JSON.stringify(results.toggle)}`);
  console.log(`page errors  ${JSON.stringify(results.pageErrors || [])}`);
  console.log(`\nshots in ${OUTDIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
