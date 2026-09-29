"use strict";

// scripts/visual-verify-noise-probe.js — THE CONTROL EXPERIMENT.
//
// lib/visual-verify.js sets thresholds below which a difference is called
// render jitter rather than a change. A threshold is a claim. This measures it:
// the SAME unmodified page, captured N times, diffed against the first.
//
// Anything that moves here moves for reasons that have nothing to do with an
// edit, and a verifier that does not know that will blame an edit for it.
//
//   node scripts/visual-verify-noise-probe.js [url] [runs]

const V = require("../lib/visual-verify");
const { xray } = require("../lib/page-xray");
const { launchChromium } = require("../lib/serverless-chromium");

const DEFAULT_URL = "https://wss-test-rimrock-plumbing-billings.wss-ai.com/";

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => /^https?:\/\//i.test(a)) || DEFAULT_URL;
  const runs = Number(args.find((a) => /^\d+$/.test(a))) || 3;
  const settleArg = args.find((a) => a.startsWith("--settle="));
  const settleMs = settleArg ? Number(settleArg.split("=")[1]) : undefined;
  console.log(`settle: ${settleMs === undefined ? "page-xray default (500ms)" : `${settleMs}ms`}`);

  const browser = await launchChromium();
  try {
    const shots = [];
    for (let i = 0; i < runs; i += 1) {
      const t = Date.now();
      const xr = await xray(url, { browser, useCache: false, crops: false, shots: false, ...(settleMs === undefined ? {} : { settleMs }) });
      if (!xr.ok) throw new Error(`capture ${i} failed: ${xr.reason}`);
      shots.push(xr);
      console.log(`capture ${i + 1}: ${xr.elements.length} elements, ${Date.now() - t}ms`);
    }

    const base = shots[0];
    console.log(`\n${"=".repeat(78)}`);
    console.log("SAME PAGE, NO EDIT — what moves anyway");
    console.log("=".repeat(78));

    for (let i = 1; i < shots.length; i += 1) {
      const other = shots[i];
      const moves = [];
      for (const b of V.elementsOf(base)) {
        if (!b.selector || !b.name) continue;
        const a = V.matchIn(V.elementsOf(other), b);
        if (!a) { moves.push({ name: b.name, selector: b.selector, gone: true }); continue; }
        const mb = V.measure(b);
        const ma = V.measure(a);
        const d = V.deltaOf(mb, ma);
        if (d.length) moves.push({ name: mb.name, selector: mb.selector, d });
      }
      console.log(`\ncapture 1 vs capture ${i + 1}:  ${moves.length} named element(s) differ`);
      for (const m of moves.slice(0, 20)) {
        if (m.gone) { console.log(`  ${m.name}  (${m.selector})  NOT FOUND in the second capture`); continue; }
        console.log(`  ${m.name}  (${m.selector})`);
        for (const x of m.d) console.log(`      ${x.metric}: ${x.from} -> ${x.to}${x.by !== undefined ? `  (${x.by > 0 ? "+" : ""}${x.by})` : ""}`);
      }
      if (moves.length > 20) console.log(`  … and ${moves.length - 20} more`);

      const worst = moves.flatMap((m) => (m.d || []).filter((x) => x.by !== undefined).map((x) => Math.abs(x.by)));
      console.log(`\n  largest movement between two captures of the same page: ${worst.length ? Math.max(...worst) : 0}px`);
    }

    // -----------------------------------------------------------------------
    // WHICH MEASUREMENTS CAN BE TRUSTED ON THIS PAGE AT ALL.
    // The verifier's whole case rests on a metric holding still when nothing
    // is done to it. This is that, per metric, across every capture.
    // -----------------------------------------------------------------------
    console.log(`\n${"=".repeat(78)}`);
    console.log("PER-METRIC STABILITY — max drift with no edit, across every capture");
    console.log("=".repeat(78));
    const metrics = ["x", "y", "w", "h", "font_px", "visible_w", "visible_h", "colour", "text", "src"];
    const worstPer = new Map(metrics.map((m) => [m, { max: 0, unstable: 0, total: 0, worstName: "" }]));
    for (const b of V.elementsOf(base)) {
      if (!b.selector || !b.name) continue;
      const mb = V.measure(b);
      for (const metric of metrics) {
        const acc = worstPer.get(metric);
        if (mb[metric] === null || mb[metric] === undefined) continue;
        acc.total += 1;
        let drift = 0;
        let differs = false;
        for (let i = 1; i < shots.length; i += 1) {
          const a = V.matchIn(V.elementsOf(shots[i]), b);
          if (!a) continue;
          const ma = V.measure(a);
          if (typeof mb[metric] === "number") {
            drift = Math.max(drift, Math.abs(ma[metric] - mb[metric]));
          } else if (String(ma[metric]) !== String(mb[metric])) {
            differs = true;
          }
        }
        if (drift > acc.max) { acc.max = drift; acc.worstName = mb.name; }
        if (drift >= 2 || differs) acc.unstable += 1;
      }
    }
    console.log(`  ${"metric".padEnd(12)}${"unstable/total".padEnd(18)}${"max drift".padEnd(14)}worst offender`);
    for (const metric of metrics) {
      const a = worstPer.get(metric);
      console.log(`  ${metric.padEnd(12)}${`${a.unstable}/${a.total}`.padEnd(18)}${`${Math.round(a.max * 10) / 10}px`.padEnd(14)}${a.worstName}`);
    }

    console.log("\n  the two elements the live proof edits are about:");
    for (const b of V.elementsOf(base)) {
      if (!b.selector || !b.name) continue;
      if (!/client-logo/.test(b.selector) && b.selector !== "h1") continue;
      const mb = V.measure(b);
      const per = [];
      for (const metric of ["x", "y", "w", "h", "font_px", "colour"]) {
        let drift = 0;
        let differs = false;
        for (let i = 1; i < shots.length; i += 1) {
          const a = V.matchIn(V.elementsOf(shots[i]), b);
          if (!a) continue;
          const ma = V.measure(a);
          if (typeof mb[metric] === "number") drift = Math.max(drift, Math.abs(ma[metric] - mb[metric]));
          else if (String(ma[metric]) !== String(mb[metric])) differs = true;
        }
        per.push(`${metric} ${differs ? "CHANGED" : `${Math.round(drift * 10) / 10}px`}`);
      }
      console.log(`    ${mb.name.padEnd(10)} ${mb.selector.padEnd(34)} ${per.join("  ·  ")}`);
    }

    // Also: the defect lists, which the verifier diffs.
    console.log(`\n${"=".repeat(78)}`);
    console.log("DEFECT LISTS — do they agree with themselves?");
    console.log("=".repeat(78));
    for (let i = 1; i < shots.length; i += 1) {
      const introduced = V.newDefects(base, shots[i]);
      console.log(`capture 1 -> capture ${i + 1}: ${introduced.length} "new" defect(s) with no edit at all`);
      for (const d of introduced.slice(0, 6)) console.log(`   ${d.at}  ${d.kind}  ${d.name} — ${d.detail}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error(String((e && e.stack) || e)); process.exitCode = 1; });
