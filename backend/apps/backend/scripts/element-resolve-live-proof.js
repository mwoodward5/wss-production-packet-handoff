"use strict";

// scripts/element-resolve-live-proof.js — the five recorded requests, on a real
// live mirror.
//
// TRUTH LAW: this script does not report that element-resolve works. It reports
//   · what the owner ACTUALLY SAID on those calls, put in verbatim
//   · which thing on the page came back, with the reasons it gave
//   · every selector it emitted, RE-RESOLVED on a fresh page load in a second
//     browser visit — so "this rule will reach exactly one thing" is proven
//     against the live DOM rather than by the run that produced it
//   · the arithmetic for the resize, against the picture's real dimensions
//   · the wall clock, because this runs while a customer is on the phone
//   · every sentence Riley would say, printed in full, so the developer-speak
//     that lost a call is visible if it comes back
//
// Usage:
//   node scripts/element-resolve-live-proof.js [url] [--vision]
//
// --vision spends ONE real Anthropic call on a deliberately ambiguous request
// and prints its token usage. Off by default; the proof is complete without it.

const { xray } = require("../lib/page-xray");
const { resolve, plainName } = require("../lib/element-resolve");
const { launchChromium } = require("../lib/serverless-chromium");

const DEFAULT_URL = "https://wss-test-rimrock-plumbing-billings.wss-ai.com/";

// The five, verbatim. Order matters: #2 says "it", and only survives because
// #1 ran first — which is exactly how it arrived on the call.
const RECORDED = [
  "make the logo twice as big",
  "move it to the right side instead of the left",
  "swap the logo with the phone call button",
  "the social media block should go below the hero",
  "make the hero image more colourful",
];

// Not from the calls, but the same shape of thing a caller says next.
const ALSO = [
  "the bar that stays when I scroll should be a bit shorter",
  "make the main headline text bright orange",
  "get rid of that chat bubble",
  "put a photo of my new truck on there",
  "make the logo fade in when you scroll",
];

const JARGON = /\b(element|selector|css|div|dom|node|class name|xpath|attribute|markup)\b/i;

function line(char = "-") { return char.repeat(78); }

function show(label, value) {
  if (value === null || value === undefined || value === "") return;
  console.log(`    ${label.padEnd(16)} ${value}`);
}

async function runOne(xr, utterance, context, opts) {
  const t0 = Date.now();
  const r = await resolve(xr, utterance, opts);
  const ms = Date.now() - t0;

  console.log(`\n  > "${utterance}"`);
  console.log(`    ${"".padEnd(16)} (${ms}ms)`);
  show("verb", `${r.verb ? r.verb.kind : "-"}${r.verb && !r.verb.supported ? "  [not implemented]" : ""}`);

  if (r.refusal) {
    show("REFUSED", r.refusal.reason);
    console.log(`    Riley says:      "${r.refusal.say}"`);
    return { r, ms, selectors: [] };
  }
  if (r.question) {
    show("confidence", r.confidence);
    console.log(`    Riley asks:      "${r.question}"`);
    for (const c of r.candidates.slice(0, 2)) {
      console.log(`      · ${String(c.score).padStart(5)}  ${plainName(c.el)} — ${c.zone}`);
    }
    return { r, ms, selectors: [] };
  }

  const selectors = [];
  show("thing", `${plainName(r.target.el)} — ${r.target.zone}`);
  show("selector", r.target.selector);
  selectors.push({ selector: r.target.selector, why: "target" });
  show("confidence", r.confidence);
  show("because", (r.target.why || []).join("; "));
  if (r.refined) show("moved onto", `${r.refined.to} (${r.refined.reason})`);

  if (r.geometry) {
    const g = r.geometry;
    if (g.natural) show("picture is", `${g.natural.w} x ${g.natural.h}`);
    show("drawn at", `${g.current.w} x ${g.current.h}`);
    if (g.proposed && g.proposed.font_px) show("type size", `${g.current_type_px}px -> ${g.proposed.font_px}px`);
    else if (g.proposed) show("would become", `${g.proposed.w} x ${g.proposed.h}  ${g.ratio_locked ? `(ratio kept from ${g.aspect_source})` : "(width left alone — this is a box, not a picture)"}`);
    show("css", g.css_hint);
    if (g.container) {
      show("box it lives in", `${g.container.name} — ${g.container.room.w} x ${g.container.room.h}`);
      if (g.container.wrappers_skipped.length) show("wrappers skipped", g.container.wrappers_skipped.join(", "));
      show("fits", g.fits === null ? "unknown" : String(g.fits));
    }
    for (const w of g.warnings) console.log(`    ! ${w.kind}: ${w.detail}`);
  }

  if (r.plan) {
    if (r.plan.apply_to) {
      show("rule goes on", `${r.plan.apply_to.name} — ${r.plan.apply_to.selector}`);
      selectors.push({ selector: r.plan.apply_to.selector, why: "apply_to" });
      if (r.plan.apply_to_wrapper) console.log(`    ! ${r.plan.apply_to_wrapper}`);
    }
    if (r.plan.method) show("method", r.plan.method);
    if (r.plan.css_hint) show("css", r.plan.css_hint);
    if (r.plan.within) show("inside", `${r.plan.within.name} (laid out as ${r.plan.within.display || "a plain block"})`);
    if (r.plan.intent) show("intent", JSON.stringify(r.plan.intent));
    if (r.plan.possible === false) show("NOT POSSIBLE", r.plan.say);
    if (r.plan.verify) {
      show("check after", r.plan.verify.expect);
      for (const s of r.plan.verify.order_before) {
        console.log(`        ${String(s.position).padStart(2)}. ${s.name.padEnd(30)} top ${String(s.top).padStart(5)}  gap below ${s.gap_below === null ? "-" : s.gap_below}`);
        if (s.selector) selectors.push({ selector: s.selector, why: "sibling order" });
      }
    }
    for (const w of r.plan.warnings || []) console.log(`    ! ${w.kind}: ${w.detail}`);
  }
  if (r.partner) {
    show("with", `${plainName(r.partner.el)} — ${r.partner.selector}`);
    selectors.push({ selector: r.partner.selector, why: "partner" });
  }
  if (r.say) console.log(`    Riley says:      "${r.say}"`);
  return { r, ms, selectors };
}

async function main() {
  const url = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_URL;
  const useVision = process.argv.includes("--vision");

  console.log(`\n${line("=")}`);
  console.log(`element-resolve live proof`);
  console.log(`url: ${url}`);
  console.log(line("="));

  const browser = await launchChromium();
  try {
    const tx = Date.now();
    const xr = await xray(url, { browser, buildHash: "resolve-proof-1" });
    if (!xr.ok) {
      console.log(`\nCOULD NOT SEE THE PAGE: ${xr.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`\nx-ray: ${xr.elements.length} things measured in ${Date.now() - tx}ms  (${xr.crops.length} crops)`);

    const results = [];
    const everySelector = [];
    const everySentence = [];

    console.log(`\n${line()}\nTHE FIVE FROM THE RECORDED CALLS\n${line()}`);
    let lastTarget = null;
    for (const utterance of RECORDED) {
      const out = await runOne(xr, utterance, null, { useVision: false, context: { lastTarget } });
      if (out.r.target) lastTarget = out.r.target;
      results.push(out);
      everySelector.push(...out.selectors);
      for (const s of [out.r.say, out.r.question, out.r.refusal && out.r.refusal.say]) if (s) everySentence.push(s);
    }

    console.log(`\n${line()}\nTHE NEXT THINGS A CALLER SAYS\n${line()}`);
    for (const utterance of ALSO) {
      const out = await runOne(xr, utterance, null, { useVision: false, context: { lastTarget } });
      results.push(out);
      everySelector.push(...out.selectors);
      for (const s of [out.r.say, out.r.question, out.r.refusal && out.r.refusal.say]) if (s) everySentence.push(s);
    }

    // -----------------------------------------------------------------
    // THE CLAIM THAT MATTERS, CHECKED INDEPENDENTLY.
    //
    // A rule aimed at something that is not there applies cleanly, reports
    // success, and changes nothing — the failure this whole module exists to
    // stop. So every selector it just emitted is run against a FRESH page load
    // in a page that never saw the run that produced them.
    // -----------------------------------------------------------------
    console.log(`\n${line()}\nEVERY SELECTOR, RE-RESOLVED ON A FRESH PAGE LOAD\n${line()}`);
    const unique = [...new Map(everySelector.map((s) => [s.selector, s])).values()].filter((s) => s.selector);
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);

    let one = 0;
    let none = 0;
    let many = 0;
    for (const entry of unique) {
      let count = -1;
      try {
        count = await page.evaluate((sel) => document.querySelectorAll(sel).length, entry.selector);
      } catch (e) {
        count = -1;
      }
      const verdict = count === 1 ? "ONE" : count === 0 ? "*** NOTHING ***" : count < 0 ? "INVALID" : `${count} THINGS`;
      if (count === 1) one += 1; else if (count === 0) none += 1; else many += 1;
      console.log(`  ${verdict.padEnd(16)} ${entry.why.padEnd(14)} ${entry.selector}`);
    }
    await page.close();

    console.log(`\n  emitted:                      ${unique.length}`);
    console.log(`  matched exactly one element:  ${one}`);
    console.log(`  matched NOTHING:              ${none}   <- the defect this exists to prevent`);
    console.log(`  matched more than one:        ${many}`);

    // -----------------------------------------------------------------
    console.log(`\n${line()}\nEVERY SENTENCE RILEY WOULD SAY\n${line()}`);
    let jargon = 0;
    for (const s of everySentence) {
      const bad = JARGON.test(s);
      if (bad) jargon += 1;
      console.log(`  ${bad ? "!! " : "   "}${s}`);
    }
    console.log(`\n  sentences: ${everySentence.length}   containing developer-speak: ${jargon}`);

    const times = results.map((r) => r.ms);
    console.log(`\n${line()}\nCOST\n${line()}`);
    console.log(`  resolve() per request: min ${Math.min(...times)}ms  max ${Math.max(...times)}ms  ` +
      `mean ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms  (browser already open, no vision)`);

    if (useVision) {
      console.log(`\n${line()}\nONE REAL VISION TIE-BREAK\n${line()}`);
      const seen = {};
      const t0 = Date.now();
      const r = await resolve(xr, "make that little icon at the bottom bigger", {
        useVision: true,
        vision: async (args) => {
          const { defaultVision } = require("../lib/element-resolve");
          const out = await defaultVision(args);
          seen.usage = out.usage;
          seen.text = out.text;
          seen.reason = out.reason;
          return out;
        },
      });
      console.log(`  wall clock:   ${Date.now() - t0}ms`);
      console.log(`  raw reply:    ${JSON.stringify(seen.text || seen.reason || "").slice(0, 200)}`);
      console.log(`  tokens:       ${JSON.stringify(seen.usage || null)}`);
      console.log(`  decided:      ${r.vision ? JSON.stringify({ used: r.vision.used, decided: r.vision.decided, pick: r.vision.pick, because: r.vision.because, saw: r.vision.saw }) : "not consulted"}`);
      console.log(`  outcome:      ${r.ok ? `resolved to ${plainName(r.target.el)}` : `asked "${r.question}"`}`);
    }

    console.log(`\n${line("=")}\n`);
    if (none > 0 || jargon > 0) process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
