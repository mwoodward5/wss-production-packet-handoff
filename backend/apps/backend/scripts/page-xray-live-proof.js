"use strict";

// scripts/page-xray-live-proof.js — the measurement, on a real live mirror.
//
// TRUTH LAW: a visual verifier that says "looks right" without evidence is the
// same defect it exists to catch. So this script does not report that page-xray
// works. It reports:
//   · the wall clock of every phase, cold and warm and cached
//   · the actual pixel files it wrote, with byte counts and digests
//   · the selectors it minted, RE-RESOLVED against a fresh page load, so the
//     claim "this selector matches exactly one element" is proven by a second
//     independent browser visit rather than by the run that made it up
//   · every defect it measured, with the numbers behind it
//
// Usage:
//   node scripts/page-xray-live-proof.js [url] [--no-crops] [--ask "the logo"]
//
// Artifacts land in artifacts/page-xray/<host>/.

const fs = require("node:fs");
const path = require("node:path");
const {
  xray,
  findByName,
  describeElement,
  withoutBuffers,
  invalidate,
} = require("../lib/page-xray");
const { launchChromium } = require("../lib/serverless-chromium");

const DEFAULT_URL = "https://wss-test-rimrock-plumbing-billings.wss-ai.com/";

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function outDir(url) {
  const host = new URL(url).hostname;
  const dir = path.join(__dirname, "..", "artifacts", "page-xray", host);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir, name, buffer) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  return { file, bytes: buffer.length };
}

function bar(label, ms, scale = 30) {
  const n = Math.max(0, Math.round((ms / scale)));
  return `${label.padEnd(14)} ${String(ms).padStart(6)}ms ${"#".repeat(Math.min(60, n))}`;
}

async function main() {
  const url = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_URL;
  const crops = !process.argv.includes("--no-crops");
  const ask = arg("--ask", "the logo top left");
  const dir = outDir(url);

  console.log(`\n=== page-xray live proof ===`);
  console.log(`url:        ${url}`);
  console.log(`artifacts:  ${dir}\n`);

  // ONE BROWSER, held open for the whole proof — exactly how site-change-plan
  // must call it. Launching per-call would also work here, but it would be
  // measuring a path the edit lane must never take (see the wiring note).
  const browser = await launchChromium();
  try {
    // ---------------------------------------------------------------
    // RUN 1 — cold. This is the number that decides "cheap enough mid-call".
    // ---------------------------------------------------------------
    const cold = await xray(url, { browser, crops, buildHash: "proof-build-1" });
    if (!cold.ok) {
      console.log(`FAILED: ${cold.reason}`);
      console.log(JSON.stringify(cold.timings, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log("--- 1. COST (cold, browser already open) ---");
    console.log(bar("open+load", cold.timings.open_ms));
    console.log(bar("  measure", cold.timings.measure_ms));
    console.log(bar("  screenshots", cold.timings.shots_ms));
    console.log(bar("  crops", cold.timings.crops_ms));
    console.log(bar("TOTAL", cold.timings.total_ms));
    console.log(`   (open+load runs the 1280 and 390 pages IN PARALLEL, so it is max() not sum())\n`);

    // ---------------------------------------------------------------
    // RUN 2 — cache hit. "a second edit in the same call is instant".
    // ---------------------------------------------------------------
    const warm = await xray(url, { browser, crops, buildHash: "proof-build-1" });
    console.log("--- 2. CACHE ---");
    console.log(`   hit:            ${warm.cache.hit}`);
    console.log(`   served in:      ${warm.cache.served_in_ms}ms  (cold was ${cold.timings.total_ms}ms)`);
    console.log(`   keyed on:       ${warm.cache.keyed_on}`);
    const dropped = invalidate(url);
    const afterInvalidate = await xray(url, { browser, crops: false, mobile: false, shots: false, buildHash: "proof-build-1" });
    console.log(`   invalidate():   dropped ${dropped} entr(ies); next call hit=${afterInvalidate.cache.hit} in ${afterInvalidate.timings.total_ms}ms (structure only)\n`);

    // ---------------------------------------------------------------
    // LAYER 1 — PIXELS
    // ---------------------------------------------------------------
    console.log("--- 3. LAYER 1: PIXELS ---");
    const files = [];
    files.push({ what: "full page 1280", ...write(dir, "desktop-1280.jpg", cold.shot.buffer), sha: cold.shot.sha256.slice(0, 16) });
    if (cold.mobile_shot) {
      files.push({ what: "full page 390", ...write(dir, "mobile-390.jpg", cold.mobile_shot.buffer), sha: cold.mobile_shot.sha256.slice(0, 16) });
    }
    let cropN = 0;
    for (const c of cold.crops) {
      if (!c.buffer) { console.log(`   crop FAILED  ${c.name} (${c.selector}) — ${c.error}`); continue; }
      cropN += 1;
      const safe = String(c.name).replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40);
      files.push({ what: `crop: ${c.name}`, ...write(dir, `crop-${String(cropN).padStart(2, "0")}-${safe}.jpg`, c.buffer), sha: c.sha256.slice(0, 16) });
    }
    for (const f of files) {
      console.log(`   ${String(f.bytes).padStart(8)} bytes  sha ${f.sha}  ${f.what.padEnd(24)} ${path.basename(f.file)}`);
    }
    console.log(`   ${files.length} image files written.\n`);

    // ---------------------------------------------------------------
    // LAYER 2 — STRUCTURE
    // ---------------------------------------------------------------
    const d = cold.desktop;
    console.log("--- 4. LAYER 2: STRUCTURE ---");
    console.log(`   visited ${d.counts.visited} elements, dropped ${d.counts.dropped_wrappers} pass-through wrappers, kept ${d.counts.kept}${d.counts.capped ? " (CAPPED)" : ""}`);
    const named = d.elements.filter((e) => e.nameable && e.name);
    console.log(`   ${named.length} carry a plain-English name a customer could say.\n`);
    console.log(`   ${"NAME".padEnd(26)} ${"ZONE".padEnd(22)} ${"SIZE".padEnd(12)} ${"TOP?".padEnd(5)} SELECTOR`);
    for (const e of named.slice(0, 22)) {
      console.log(`   ${String(e.name).slice(0, 25).padEnd(26)} ${String(e.zone).slice(0, 21).padEnd(22)} ${`${Math.round(e.rect.w)}x${Math.round(e.rect.h)}`.padEnd(12)} ${String(e.topmost).padEnd(5)} ${e.selector}`);
    }

    const byKind = {};
    for (const e of d.elements) {
      const k = e.selector ? e.selector_kind : "NONE";
      byKind[k] = (byKind[k] || 0) + 1;
    }
    console.log(`\n   selector kinds: ${JSON.stringify(byKind)}`);
    console.log(`   stable across a rebuild: ${d.elements.filter((e) => e.selector_stable).length} / ${d.elements.length}\n`);

    // ---------------------------------------------------------------
    // THE PROOF THAT MATTERS: re-resolve every selector on a FRESH page.
    // ---------------------------------------------------------------
    console.log("--- 5. SELECTOR PROOF (fresh page load, independent of the run that minted them) ---");
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "load", timeout: 25000 });
    await page.waitForFunction(() => document.body && document.body.innerText.length > 120, null, { timeout: 12000 }).catch(() => {});
    const selectors = d.elements.filter((e) => e.selector).map((e) => ({ selector: e.selector, index: e.index, name: e.name }));
    const resolved = await page.evaluate((list) => list.map((s) => {
      try { return { ...s, n: document.querySelectorAll(s.selector).length }; } catch (err) { return { ...s, n: -1, err: String(err.message || err) }; }
    }), selectors);
    const exactlyOne = resolved.filter((r) => r.n === 1);
    const zero = resolved.filter((r) => r.n === 0);
    const many = resolved.filter((r) => r.n > 1);
    const invalid = resolved.filter((r) => r.n === -1);
    console.log(`   ${resolved.length} selectors emitted`);
    console.log(`   matched exactly one element: ${exactlyOne.length}`);
    console.log(`   matched NOTHING:             ${zero.length}   <- the defect this module exists to prevent`);
    console.log(`   matched more than one:       ${many.length}`);
    console.log(`   invalid CSS:                 ${invalid.length}`);
    for (const r of [...zero, ...many, ...invalid].slice(0, 8)) console.log(`      ${r.n}  ${r.name || "(unnamed)"}  ${r.selector}`);
    await page.close().catch(() => {});
    console.log("");

    // ---------------------------------------------------------------
    // LAYER 3 — STYLE
    // ---------------------------------------------------------------
    console.log("--- 6. LAYER 3: STYLE ---");
    const imgs = d.elements.filter((e) => e.image && e.image.natural);
    console.log(`   ${imgs.length} images with an intrinsic size:`);
    console.log(`   ${"NAME".padEnd(20)} ${"NATURAL".padEnd(12)} ${"DISPLAYED".padEnd(12)} ${"FIT".padEnd(10)} ${"RATIO".padEnd(7)} VERDICT`);
    for (const e of imgs.slice(0, 14)) {
      const im = e.image;
      const verdict = (im.verdicts || []).map((v) => v.kind).join(",") || "faithful";
      console.log(`   ${String(e.name || e.tag).slice(0, 19).padEnd(20)} ${`${im.natural.w}x${im.natural.h}`.padEnd(12)} ${`${im.displayed.w}x${im.displayed.h}`.padEnd(12)} ${String(im.fit).padEnd(10)} ${String(im.distortion).padEnd(7)} ${verdict}`);
    }
    const texts = d.elements.filter((e) => e.text && e.style.colorHex);
    console.log(`\n   typography (first 8 text-bearing elements):`);
    console.log(`   ${"NAME".padEnd(20)} ${"FONT".padEnd(18)} ${"SIZE".padEnd(8)} ${"WEIGHT".padEnd(7)} ${"COLOR".padEnd(9)} ${"ON".padEnd(9)} CONTRAST`);
    for (const e of texts.slice(0, 8)) {
      console.log(`   ${String(e.name || e.tag).slice(0, 19).padEnd(20)} ${String(e.style.fontFamily).slice(0, 17).padEnd(18)} ${String(e.style.fontSize).padEnd(8)} ${String(e.style.fontWeight).padEnd(7)} ${String(e.style.colorHex || e.style.color).slice(0, 8).padEnd(9)} ${String(e.style.effectiveBackgroundHex || "-").padEnd(9)} ${e.contrast === null ? "n/a" : e.contrast}`);
    }
    console.log("");

    // ---------------------------------------------------------------
    // DEFECTS
    // ---------------------------------------------------------------
    console.log("--- 7. MEASURED DEFECTS (every one carries its numbers) ---");
    if (!cold.defects.length) console.log("   none measured at 1280 or 390.");
    const seen = new Set();
    for (const df of cold.defects) {
      const k = `${df.kind}|${df.selector}|${df.at}`;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`   [${df.at.padStart(4)}] ${df.kind.padEnd(20)} ${String(df.name).slice(0, 22).padEnd(23)} ${df.detail}`);
    }
    console.log("");

    // ---------------------------------------------------------------
    // THE ORIGINAL FAILURE, ANSWERED
    // ---------------------------------------------------------------
    console.log(`--- 8. "${ask}" ---`);
    const found = findByName(cold, ask);
    if (!found.ok) {
      console.log(`   ${found.reason}`);
    } else {
      console.log(`   ambiguous: ${found.ambiguous}${found.ambiguous ? "  -> the caller must be asked which one; guessing is the failure" : ""}`);
      for (const m of found.matches.slice(0, 3)) {
        console.log(`   ${String(m.score).padStart(5)}  ${m.selector}`);
        console.log(`          ${describeElement(m)}`);
        console.log(`          because: ${m.why.join("; ")}`);
      }
    }

    const jsonPath = path.join(dir, "xray.json");
    fs.writeFileSync(jsonPath, JSON.stringify(withoutBuffers(cold), null, 2));
    console.log(`\n   full record (buffers stripped): ${jsonPath} (${fs.statSync(jsonPath).size} bytes)`);
    console.log(`\n=== done in ${cold.timings.total_ms}ms cold / ${warm.cache.served_in_ms}ms cached ===\n`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
