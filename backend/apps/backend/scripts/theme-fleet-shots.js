"use strict";
/**
 * scripts/theme-fleet-shots.js — LOOK AT THE LIVE PAGE, in both themes, at both
 * widths. Nothing here reads our build reports; it renders what a visitor gets.
 *
 * WHY BOTH THEMES ARE DRIVEN THROUGH THE REAL TOGGLE. Setting
 * `data-wss-theme="dark"` from the test would prove the CSS exists, not that a
 * visitor can reach it. The dark shots are taken by clicking the control the
 * page ships, then re-reading the attribute, so a toggle that renders but does
 * not work fails here instead of in front of the owner.
 *
 * WHY THE FOLD IS MEASURED SEPARATELY FROM THE FULL PAGE. The owner's complaint
 * is about the FIRST SCREENFUL — that is the email thumbnail and the visitor's
 * first impression. A full-page average of a 9,000px marketing page hides it:
 * a white footer can carry a black hero to a "light" verdict. `foldBright` is
 * the number that answers his question.
 *
 *   node scripts/theme-fleet-shots.js --urls a,b,c --tag before
 *   node scripts/theme-fleet-shots.js --list artifacts/rebuild-spread.json --tag after
 *
 * Writes artifacts/theme-shots/<tag>/<slug>-{light,dark}-{1280,390}.png and
 * artifacts/theme-shots/<tag>.json
 */

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePngToRgba } = require("../lib/png-decode");

const ROOT = path.join(__dirname, "..");
const arg = (n, d = "") => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const TAG = arg("tag", "shots");
const OUTDIR = path.join(ROOT, "artifacts", "theme-shots", TAG);
const FULL = process.argv.includes("--full");

const slugify = (s) => String(s).toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "").replace(/^wss-test-/, "").slice(0, 58);

// --- brightness of real pixels, the only reading that cannot lie -------------
const chan = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };

function brightShare(png) {
  const img = decodePngToRgba(png);
  let bright = 0, dark = 0, n = 0;
  for (let y = 0; y < img.height; y += 4) {
    for (let x = 0; x < img.width; x += 4) {
      const i = (y * img.width + x) * 4;
      const L = 0.2126 * chan(img.data[i]) + 0.7152 * chan(img.data[i + 1]) + 0.0722 * chan(img.data[i + 2]);
      if (L >= 0.5) bright++;
      if (L <= 0.12) dark++;
      n++;
    }
  }
  return { bright: +(bright / n).toFixed(3), dark: +(dark / n).toFixed(3) };
}

async function shootOne(browser, url, name) {
  const slug = slugify(name || url);
  const out = { url, name: name || url, slug, ok: false, shots: {}, toggle: {}, errors: [] };
  for (const width of [1280, 390]) {
    const ctx = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      deviceScaleFactor: 1,
      userAgent: width === 390
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => out.errors.push(`${width}:${String(e.message).slice(0, 140)}`));
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      out.status = resp ? resp.status() : 0;
      await page.waitForTimeout(4200);
      out.title = await page.title();

      // FILES ARE NAMED FOR THE THEME THAT ACTUALLY RENDERED, not for the one
      // we expected. The first version called the default shot "light" and the
      // toggled shot "dark" — correct for 95% of the fleet and exactly backwards
      // for Gunther Plumbing, whose site measures dark and therefore BOOTS dark.
      // Screenshots are the deliverable here, and a mislabelled screenshot is
      // worse than no screenshot: it argues for the opposite of what it shows.
      const modeAtLoad = (await page.getAttribute("html", "data-wss-theme")) === "dark" ? "dark" : "light";
      const defaultPng = await page.screenshot();
      fs.writeFileSync(path.join(OUTDIR, `${slug}-${modeAtLoad}-${width}.png`), defaultPng);
      out.shots[`${modeAtLoad}-${width}`] = { mode: modeAtLoad, isDefault: true, fold: brightShare(defaultPng) };
      out.defaultMode = modeAtLoad;
      if (FULL && width === 1280) {
        const fullPng = await page.screenshot({ fullPage: true });
        fs.writeFileSync(path.join(OUTDIR, `${slug}-${modeAtLoad}-full.png`), fullPng);
        out.shots[`${modeAtLoad}-full`] = { fold: brightShare(fullPng) };
      }

      // THE OTHER THEME — via the control a visitor can actually click.
      const toggle = await page.$("[data-wss-theme-toggle]");
      out.toggle[width] = { present: !!toggle };
      if (toggle) {
        await toggle.click();
        await page.waitForTimeout(900);
        const after = (await page.getAttribute("html", "data-wss-theme")) === "dark" ? "dark" : "light";
        out.toggle[width].from = modeAtLoad;
        out.toggle[width].to = after;
        const otherPng = await page.screenshot();
        fs.writeFileSync(path.join(OUTDIR, `${slug}-${after}-${width}.png`), otherPng);
        out.shots[`${after}-${width}`] = { mode: after, isDefault: false, fold: brightShare(otherPng) };
        if (FULL && width === 1280) {
          const fullPng = await page.screenshot({ fullPage: true });
          fs.writeFileSync(path.join(OUTDIR, `${slug}-${after}-full.png`), fullPng);
          out.shots[`${after}-full`] = { fold: brightShare(fullPng) };
        }
        // It must SURVIVE a reload, or it is a gimmick.
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1800);
        out.toggle[width].afterReload = await page.getAttribute("html", "data-wss-theme");
      }
      out.ok = true;
    } catch (e) {
      out.errors.push(`${width}:${String(e.message).slice(0, 160)}`);
    }
    await ctx.close();
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUTDIR, { recursive: true });
  let targets = [];
  const list = arg("list", "");
  if (list) {
    const p = path.isAbsolute(list) ? list : path.join(ROOT, list);
    targets = JSON.parse(fs.readFileSync(p, "utf8"));
  } else {
    targets = arg("urls", "").split(",").map((u) => u.trim()).filter(Boolean).map((u) => ({ url: u }));
  }
  if (!targets.length) { console.error("--urls or --list required"); process.exit(2); }

  const browser = await chromium.launch();
  const results = [];
  for (const t of targets) {
    const r = await shootOne(browser, t.url || t.preview_url, t.name || t.business_name || t.url);
    results.push(r);
    const l = r.shots["light-1280"], d = r.shots["dark-1280"];
    console.log(
      `${(r.name || "").slice(0, 40).padEnd(42)} http:${r.status || "-"} boots ${String(r.defaultMode || "-").padEnd(5)} `
      + `light-fold bright=${l ? l.fold.bright : "-"}  `
      + `dark-fold bright=${d ? d.fold.bright : "-"}  `
      + `toggle=${r.toggle[1280] && r.toggle[1280].present ? `${r.toggle[1280].from}->${r.toggle[1280].to}, reload=${r.toggle[1280].afterReload}` : "ABSENT"}`
      + (r.errors.length ? `  ERR ${r.errors[0]}` : ""),
    );
  }
  await browser.close();
  fs.writeFileSync(path.join(ROOT, "artifacts", "theme-shots", `${TAG}.json`), JSON.stringify(results, null, 1));
  // COUNTED BY WHAT THE PAGE BOOTS AS, not by which files exist. A dark-default
  // mirror still produces a light-1280.png — it is the toggled shot — and the
  // first version of this line counted it, reporting "7/7 light" for a spread
  // that contained a site booting dark.
  const booted = results.filter((r) => r.defaultMode);
  const lightDefault = booted.filter((r) => r.defaultMode === "light");
  console.log(`\nboots LIGHT: ${lightDefault.length}/${booted.length}`
    + `   boots DARK: ${booted.length - lightDefault.length}/${booted.length}`
    + ` (${booted.filter((r) => r.defaultMode === "dark").map((r) => r.slug).join(", ") || "none"})`);
  const agree = booted.filter((r) => {
    const s = r.shots[`${r.defaultMode}-1280`];
    return s && (r.defaultMode === "light" ? s.fold.bright >= 0.5 : s.fold.bright < 0.5);
  }).length;
  console.log(`pixels agree with the declared theme: ${agree}/${booted.length}`);
  console.log(`shots in ${OUTDIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
