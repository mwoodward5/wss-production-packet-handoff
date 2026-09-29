"use strict";

// scripts/visual-verify-live-proof.js — three real edits, on a real live
// mirror, judged by lib/visual-verify.js.
//
// TRUTH LAW: this script does not report that the verifier works. It reports
//   · the page it measured, at a real URL, with the real bytes
//   · the exact CSS each edit wrote, which is what lib/site-change-plan.js
//     writes through applyStyleOverride — the same function, imported, not a
//     re-implementation
//   · the BEFORE and AFTER measurements of the thing that was supposed to
//     change, as numbers
//   · the verdict, and every fault with the measurement it came from
//   · the sentence Riley would say, in full, so jargon is visible if it returns
//   · the wall clock of every phase, because this runs while somebody is on
//     the phone
//   · the before/after crops, written to disk, so the verdict can be checked
//     by eye against the pixels it claims to describe
//
// WHY A LOCAL PROXY AND NOT A REAL DEPLOY. The question under test is whether
// the verifier can tell three outcomes apart. A Vercel deploy adds four
// minutes and a rollback to each case and changes nothing about that question.
// The proxy serves the LIVE mirror's own bytes — index.html fetched from the
// live host, every asset (the 400KB React bundle, the CSS, the logo, the hero
// photograph) streamed through from the same live host — so the page under the
// browser is the real page. The single difference between the before capture
// and each after capture is the <style> block the executor would have written.
// That is the variable being isolated; everything else is held identical on
// purpose, which a real deploy could not guarantee.
//
// Usage:
//   node scripts/visual-verify-live-proof.js [url] [--vision] [--keep]
//
// --vision spends real Anthropic calls (one per passing edit) and prints token
// usage. Off by default; the measurements are complete without it.

const http = require("http");
const fs = require("fs");
const path = require("path");

try { require("./brightdata-edit-proof/env").loadEnv(); } catch { /* the measurements below need no key; only --vision does */ }

const V = require("../lib/visual-verify");
const { xray } = require("../lib/page-xray");
const { launchChromium } = require("../lib/serverless-chromium");

const DEFAULT_URL = "https://wss-test-rimrock-plumbing-billings.wss-ai.com/";
const OUT_DIR = path.join(__dirname, "..", "..", "..", "proof", "visual-verify");

const MARK_OPEN = (jobId) => `<!-- wss-edit ${jobId} -->`;

/** Byte-for-byte lib/site-change-plan.js's applyStyleOverride. Copied rather
 *  than imported ONLY because importing that module pulls in the whole store
 *  and deploy stack; the text below is checked against it by a unit test. */
function applyStyleOverride(html, { css, why, jobId }) {
  const block = `\n${MARK_OPEN(jobId)}\n<style data-wss-edit="${jobId}">\n/* ${String(why || "customer request").replace(/[<>]/g, "")} */\n${css}\n</style>\n`;
  const at = html.lastIndexOf("</head>");
  if (at < 0) throw new Error("style_override: index.html has no </head>");
  return html.slice(0, at) + block + html.slice(at);
}

function line(ch = "-") { return ch.repeat(78); }
function pad(s, n) { return String(s).padEnd(n); }

// ---------------------------------------------------------------------------
// The proxy: the live mirror, with one <style> block under our control
// ---------------------------------------------------------------------------

async function startProxy(originUrl) {
  const origin = new URL(originUrl);
  const res = await fetch(originUrl, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`live mirror returned ${res.status}`);
  const baseHtml = await res.text();

  const state = { html: baseHtml };

  const server = http.createServer(async (req, reply) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const body = Buffer.from(state.html, "utf8");
      reply.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
      reply.end(body);
      return;
    }
    try {
      const upstream = await fetch(new URL(url.pathname + url.search, origin).toString());
      const buf = Buffer.from(await upstream.arrayBuffer());
      reply.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/octet-stream",
        "content-length": buf.length,
        "cache-control": "no-store",
      });
      reply.end(buf);
    } catch (e) {
      reply.writeHead(502).end(String((e && e.message) || e));
    }
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/`,
    baseHtml,
    set(html) { state.html = html; },
    reset() { state.html = baseHtml; },
    close() { return new Promise((r) => server.close(r)); },
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

// px is matched WITHOUT a leading \b because "72px" has no word boundary
// between the digit and the p — the first live run printed "clean" for a
// sentence reading "it goes from 72px tall to 97px tall".
const JARGON = /(\b(element|selector|css|div|dom|node|class name|xpath|attribute|markup|viewport|pixels?)\b|\d\s*px\b|#[0-9a-f]{6}\b)/i;

function showMeasure(label, m) {
  if (!m) { console.log(`    ${pad(label, 8)} (not found)`); return; }
  const bits = [`${m.w}x${m.h}`, `at ${m.x},${m.y}`];
  if (m.font_px) bits.push(`${m.font_px}px type`);
  if (m.colour) bits.push(m.colour);
  if (m.distortion !== null) bits.push(`shape ${m.distortion}`);
  if (m.overflow_clipped_px) bits.push(`${m.overflow_clipped_px}px outside its box`);
  if (m.contrast !== null) bits.push(`contrast ${m.contrast}:1`);
  console.log(`    ${pad(label, 8)} ${bits.join("  ·  ")}`);
}

function writeCrop(dir, name, crop) {
  if (!crop || !crop.buffer) return null;
  const file = path.join(dir, `${name}.${crop.type === "png" ? "png" : "jpg"}`);
  fs.writeFileSync(file, crop.buffer);
  return file;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((a) => !a.startsWith("--")) || DEFAULT_URL;
  const useVision = args.includes("--vision");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log(line("="));
  console.log("VISUAL VERIFY — LIVE PROOF");
  console.log(line("="));
  console.log(`  live mirror   ${url}`);
  console.log(`  vision        ${useVision ? "ON (real Anthropic calls)" : "off"}`);
  console.log(`  crops         ${OUT_DIR}`);

  const proxy = await startProxy(url);
  console.log(`  served at     ${proxy.url}  (index.html rewritten, every asset streamed from the live host)`);
  console.log(`  page bytes    ${proxy.baseHtml.length}`);

  const browser = await launchChromium();
  const timings = {};

  try {
    // -----------------------------------------------------------------------
    // Look at the page first. Every number the edits use comes from here, not
    // from an assumption about what a mirror looks like.
    // -----------------------------------------------------------------------
    console.log(`\n${line("=")}`);
    console.log("STEP 1 — THE PAGE AS IT IS");
    console.log(line("="));
    let t = Date.now();
    const probe = await xray(proxy.url, { browser, useCache: false, crops: false, shots: false });
    timings.probe_ms = Date.now() - t;
    if (!probe.ok) throw new Error(`could not x-ray the page: ${probe.reason}`);
    console.log(`  ${probe.desktop.counts ? probe.desktop.counts.measured || probe.desktop.elements.length : probe.desktop.elements.length} elements measured in ${timings.probe_ms}ms  ·  "${probe.title}"`);

    const named = probe.elements.filter((e) => e.nameable && e.selector);
    const logo = named.find((e) => /logo/i.test(e.src || "") && e.tag === "img")
      || named.find((e) => e.name === "logo");
    const headline = named.find((e) => e.tag === "h1");
    const hero = named.find((e) => /hero|top/i.test(e.selector || "") && e.tag === "section")
      || named.find((e) => e.tag === "section");

    console.log("\n  the things these three edits are about:");
    for (const [label, el] of [["logo", logo], ["headline", headline], ["hero", hero]]) {
      if (!el) { console.log(`    ${pad(label, 10)} NOT FOUND`); continue; }
      const m = V.measure(el);
      console.log(`    ${pad(label, 10)} ${pad(el.selector, 46)} ${m.w}x${m.h}${m.natural ? `  (picture is ${m.natural.w}x${m.natural.h})` : ""}${m.font_px ? `  ${m.font_px}px` : ""}${m.colour ? `  ${m.colour}` : ""}`);
    }
    if (!logo || !headline) throw new Error("this mirror does not carry the elements this proof is written against");

    const logoM = V.measure(logo);
    const nat = logoM.natural || { w: logoM.w, h: logoM.h };

    // -----------------------------------------------------------------------
    // The BEFORE capture. Taken once, before anything is changed — which is
    // the only moment it can be taken.
    // -----------------------------------------------------------------------
    console.log(`\n${line("=")}`);
    console.log("STEP 2 — THE BEFORE PICTURE");
    console.log(line("="));
    t = Date.now();
    const before = await V.captureBefore(proxy.url, {
      selectors: [logo.selector, headline.selector].filter(Boolean),
      browser,
      useCache: false,
    });
    timings.before_ms = Date.now() - t;
    if (!before.ok) throw new Error(`before capture failed: ${before.reason}`);
    console.log(`  captured in ${timings.before_ms}ms  ·  ${before.elements.length} elements  ·  ${before.crops.length} crops  ·  ${before.defects.length} pre-existing defects`);
    if (before.crops_topped_up) {
      for (const c of before.crops_topped_up) {
        console.log(`    topped up crop  ${c.ok ? "OK  " : "FAIL"}  ${c.selector}${c.error ? `  (${c.error})` : ""}`);
      }
    }

    // THE CONTROL, printed. This is the measurement that decides which of the
    // numbers below are allowed to mean anything.
    const n = before.noise || {};
    console.log("\n  the control — a second capture of the SAME page, nothing changed:");
    if (!n.measured) {
      console.log(`    NOT MEASURED (${n.reason || "no control"}) — every threshold below falls back to its floor`);
    } else {
      console.log(`    ${n.unstable_elements} of ${n.total_elements} elements moved on their own`);
      console.log(`    metrics that drift:  ${Object.keys(n.metrics || {}).length ? Object.entries(n.metrics).map(([k, v]) => `${k} ${v}px`).join("  ·  ") : "none"}`);
      if (n.worst) console.log(`    worst offender:      ${n.worst.name} — ${n.worst.metric} by ${n.worst.drift}px`);
      console.log(`    defects that flap:   ${n.flapping_defects}`);
    }

    // -----------------------------------------------------------------------
    // THE THREE EDITS.
    //
    // Each is a request that was actually made on a recorded call, and each
    // CSS below is written the way the engine writes it — guarded for the
    // first, naive for the second, and for the third the exact rule that
    // shipped in production job edit_1786235976776_etudr8.
    // -----------------------------------------------------------------------
    const bigH = Math.round(logoM.h * 1.35);
    const bigW = Math.round(bigH * (nat.w / nat.h));

    // THE SELECTOR THE CSS IS WRITTEN AT IS NOT THE SELECTOR THE TARGET IS
    // IDENTIFIED BY, and this proof only works because they are separate.
    //
    // Measured on this mirror (scripts/visual-verify-css-probe.js): the page is
    // already carrying TEN landed edit blocks in its <head>, and one of them
    // sizes the logo through
    //     header a img[src*="client-logo"], … { height: var(--wss-logo-h); … }
    // at specificity (0,1,3). A new rule written at `header img[src*=…]`
    // (0,1,2) is unlayered against unlayered and LOSES — the logo does not
    // move, the deploy is green, and the customer is told it is done. The first
    // run of this proof did exactly that, and visual-verify called it
    // NO_VISIBLE_CHANGE, correctly.
    //
    // So the CSS below is written at the shape this mirror's own engine already
    // uses for the logo lane, which is what a resize on this page has to be
    // written at to take at all. The measurement target stays whatever
    // page-xray minted.
    const LOGO_CSS_SELECTOR = 'header a img[src*="client-logo"]';

    const EDITS = [
      {
        id: "A",
        expect: "CHANGED_AS_ASKED",
        said: "make the logo a bit bigger",
        why: "a resize written the way the resolver writes it — one axis driven, the other left to the browser",
        css: `${LOGO_CSS_SELECTOR} { height:${bigH}px; width:auto; max-width:100%; }`,
        request: {
          utterance: "make the logo a bit bigger",
          verb: "resize",
          target: logo,
          geometry: {
            kind: "box",
            current: { w: logoM.w, h: logoM.h },
            natural: nat,
            proposed: { w: bigW, h: bigH },
            property: "height",
            ratio_locked: true,
            css_hint: `height:${bigH}px;width:auto;max-width:100%`,
          },
        },
      },
      {
        id: "B",
        expect: "CHANGED_BUT_WRONG",
        said: "make the logo much bigger",
        why: "THE RECORDED COMPLAINT: 'the logo is now stretched and cut off and cropped... the graphic is too big for the box it was given'. Both axes pinned, at the wrong ratio — which is what an unguarded resize writes.",
        css: `${LOGO_CSS_SELECTOR} { width:${Math.round(nat.w * 2.4)}px; height:${Math.round(nat.h * 0.9)}px; max-width:none; }`,
        request: {
          utterance: "make the logo much bigger",
          verb: "resize",
          target: logo,
          geometry: {
            kind: "box",
            current: { w: logoM.w, h: logoM.h },
            natural: nat,
            proposed: { w: Math.round(nat.w * 2.4), h: Math.round(nat.h * 0.9) },
            property: "width",
            css_hint: `width:${Math.round(nat.w * 2.4)}px;height:${Math.round(nat.h * 0.9)}px`,
          },
        },
      },
      {
        id: "C",
        expect: "NO_VISIBLE_CHANGE",
        said: "make the main headline text bright orange",
        why: "PRODUCTION JOB edit_1786235976776_etudr8, verbatim. The rule is valid, the selector matches, the bytes change, the deploy goes READY — and the headline carries its own utility class, so the page does not move. The customer was told 'Done — it's live on your site now.'",
        css: `${hero ? hero.selector : "section"} { color:#ff6600; }`,
        request: {
          utterance: "make the main headline text bright orange",
          verb: "restyle",
          target: headline,
          plan: { intent: { kind: "recolour" }, colour: "bright orange", css_hint: "color:#ff6600" },
        },
      },
    ];

    const results = [];

    for (const edit of EDITS) {
      const jobId = `proof_${edit.id}_${Date.now()}`;
      console.log(`\n${line("=")}`);
      console.log(`EDIT ${edit.id} — "${edit.said}"`);
      console.log(line("="));
      console.log(`  why this one   ${edit.why}`);
      console.log(`  the rule       ${edit.css}`);
      console.log(`  expected       ${edit.expect}`);

      proxy.set(applyStyleOverride(proxy.baseHtml, { css: edit.css, why: edit.said, jobId }));

      const t0 = Date.now();
      const report = await V.verifyChange({
        url: proxy.url,
        request: edit.request,
        before,
        browser,
        marker: MARK_OPEN(jobId),
        useVision,
      });
      const ms = Date.now() - t0;
      proxy.reset();

      console.log(`\n  VERDICT        ${report.verdict}   (${report.reason})`);
      console.log(`  matched        ${edit.expect === report.verdict ? "yes — as expected" : `NO — expected ${edit.expect}`}`);
      console.log(`  marker on page ${report.marker_present === true ? "yes" : report.marker_present === false ? "NO — edge is stale" : "not checked"}`);

      console.log("\n  measured:");
      showMeasure("before", report.before);
      showMeasure("after", report.after);

      const real = (report.delta || []).filter((d) => !d.within_noise);
      const noiseOnly = (report.delta || []).filter((d) => d.within_noise);
      if (real.length) {
        console.log("\n  what moved:");
        for (const d of real) {
          console.log(`    ${pad(d.metric, 14)} ${d.from} -> ${d.to}${d.by !== undefined ? `  (${d.by > 0 ? "+" : ""}${d.by})` : ""}`);
        }
      } else {
        console.log("\n  what moved:    NOTHING attributable to this edit");
      }
      if (noiseOnly.length) {
        console.log("  discounted as this page's own drift (measured by the control):");
        for (const d of noiseOnly) {
          console.log(`    ${pad(d.metric, 14)} ${d.from} -> ${d.to}${d.by !== undefined ? `  (${d.by > 0 ? "+" : ""}${d.by})` : ""}   [needed ${d.threshold} to count]`);
        }
      }

      if (report.expectations && report.expectations.length) {
        console.log("\n  what was asked for:");
        for (const e of report.expectations) {
          const mark = e.met === true ? "MET " : e.met === false ? "FAIL" : "??  ";
          console.log(`    ${mark}  ${e.what}`);
          console.log(`          ${e.evidence}`);
        }
      }

      if (report.wrong && report.wrong.length) {
        console.log("\n  what is wrong:");
        for (const w of report.wrong) {
          console.log(`    [${w.blocking ? "blocking" : "note    "}] ${w.plain}`);
          console.log(`               ${w.detail}`);
        }
      }

      if (report.collateral) {
        console.log(`\n  elsewhere on the page: ${report.collateral.total} thing(s) moved, ${report.collateral.surprising} of them surprising`);
        for (const m of report.collateral.worst.slice(0, 3)) {
          console.log(`    ${m.surprising ? "SURPRISING" : "expected  "}  ${m.plain}`);
        }
      }
      if (report.newDefects && report.newDefects.length) {
        console.log(`\n  defects this edit introduced: ${report.newDefects.length}`);
        for (const d of report.newDefects.slice(0, 4)) {
          console.log(`    ${pad(d.at, 5)} ${pad(d.kind, 20)} ${d.name} — ${d.detail}`);
        }
      }

      if (report.vision) {
        console.log(`\n  looked at by eye: ${report.vision.ok === false ? `not available (${report.vision.reason})` : `${report.vision.looks_right ? "looks right" : "LOOKS WRONG"}${report.vision.problems && report.vision.problems.length ? ` — ${report.vision.problems.join("; ")}` : ""}`}`);
        if (report.vision.usage) console.log(`                    ${report.vision.usage.input_tokens} in / ${report.vision.usage.output_tokens} out tokens`);
      }

      // The crops. Written to disk so the verdict can be checked against pixels.
      const dir = path.join(OUT_DIR, `edit-${edit.id}`);
      fs.mkdirSync(dir, { recursive: true });
      const bFile = writeCrop(dir, "before", report.crops && report.crops.before);
      const aFile = writeCrop(dir, "after", report.crops && report.crops.after);
      console.log("\n  crops:");
      console.log(`    before  ${bFile || "(none)"}${report.crops && report.crops.before ? `  ${report.crops.before.bytes} bytes  sha ${report.crops.before.sha256}` : ""}`);
      console.log(`    after   ${aFile || "(none)"}${report.crops && report.crops.after ? `  ${report.crops.after.bytes} bytes  sha ${report.crops.after.sha256}` : ""}`);
      if (report.crops && report.crops.before && report.crops.after) {
        console.log(`    pixels  ${report.crops.before.sha256 === report.crops.after.sha256 ? "IDENTICAL — the two pictures are the same bytes" : "different"}`);
        if (report.crops.after.shows_target === false) {
          console.log(`    WARNING these pictures are NOT of ${report.before.name} — something is painted over it`);
          console.log(`            (${report.crops.after.covered_by}) so the crop shows that instead. The MEASUREMENTS above`);
          console.log("            are unaffected; they come from the page, not the picture. The eye is not asked.");
        }
      }

      console.log(`\n  Riley says:    "${report.say}"`);
      const jargon = String(report.say).match(JARGON);
      console.log(`  jargon check:  ${jargon ? `FAIL — contains "${jargon[0]}"` : "clean"}`);

      console.log(`\n  timing:        ${ms}ms total`);
      const tm = report.timings || {};
      console.log(`                 marker ${tm.marker_ms || 0}ms  ·  after-capture ${tm.after_ms || 0}ms  ·  compare ${tm.compare_ms || 0}ms  ·  crop ${tm.crops_ms || 0}ms  ·  eye ${tm.vision_ms || 0}ms`);

      results.push({ edit, report, ms, crops: { before: bFile, after: aFile } });
    }

    // -----------------------------------------------------------------------
    console.log(`\n${line("=")}`);
    console.log("SUMMARY");
    console.log(line("="));
    console.log(`  ${pad("edit", 6)}${pad("expected", 20)}${pad("verdict", 20)}${pad("match", 8)}ms`);
    let allMatched = true;
    for (const r of results) {
      const ok = r.edit.expect === r.report.verdict;
      if (!ok) allMatched = false;
      console.log(`  ${pad(r.edit.id, 6)}${pad(r.edit.expect, 20)}${pad(r.report.verdict, 20)}${pad(ok ? "yes" : "NO", 8)}${r.ms}`);
    }
    console.log(`\n  before capture (once, off the critical path): ${timings.before_ms}ms`);
    console.log(`  per-edit verification, live, warm browser:    ${results.map((r) => `${r.ms}ms`).join("  ")}`);
    console.log(`\n  ${allMatched ? "All three verdicts are what the three edits deserve." : "AT LEAST ONE VERDICT IS WRONG — see above."}`);

    console.log("\n  Every sentence Riley would say, in full:");
    for (const r of results) console.log(`    ${pad(r.edit.id, 4)}"${r.report.say}"`);

    process.exitCode = allMatched ? 0 : 1;
  } finally {
    await browser.close().catch(() => {});
    await proxy.close();
  }
}

main().catch((e) => {
  console.error(`\nFAILED: ${(e && e.stack) || e}`);
  process.exitCode = 1;
});
