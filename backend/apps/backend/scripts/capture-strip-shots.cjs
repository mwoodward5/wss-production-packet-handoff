"use strict";
// scripts/capture-strip-shots.cjs
// -----------------------------------------------------------------------------
// SHORTER phone thumbnails for the ABOVE-THE-FOLD before/after strip.
//
// WHY THIS EXISTS. The full 390x844 phone captures are the right shots for a
// standalone comparison, but rendered side by side at ~46% of a 390px email they
// are 335px tall, and that single row eats the vertical budget the owner wants
// spent on the feature list and the Signal report. Displaying them at a smaller
// WIDTH would just make both illegible. So we shorten the capture instead.
//
// WHY THIS IS STILL HONEST. A responsive page lays itself out from the viewport
// WIDTH. Width is unchanged at 390. Only the height of the window changes, so
// the page's layout is byte-identical to the tall capture — we are simply
// photographing less of it. And the change is applied to BOTH phones through the
// SAME exported captureHero() with the SAME PHONE_SHOT flags, so the fairness
// invariant the tall strip established (same viewport, same UA, same scroll-
// through, same settle, same JPEG quality, nothing dismissed, neither cropped
// relative to the other) is preserved exactly. If one of the two fails, the
// strip is omitted rather than shown one-sided.
//
// Outputs:
//   <slug>-mobile-strip.jpg          390x620  the NEW mirror, on a phone
//   <slug>-current-mobile-strip.jpg  390x620  their CURRENT site, on a phone
//   strip-manifest.json
// -----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const PLAYWRIGHT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/node_modules/playwright";
const { captureHero, PHONE_SHOT, TARGETS, OUT_DIR } = require("./capture-email-shots.cjs");

// The ONE knob. 390 wide is untouched (layout-determining); only the window is
// shorter. Both phones read from this same object.
const STRIP_PHONE = { ...PHONE_SHOT, viewport: { width: 390, height: 620 } };

async function main() {
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "ramon";
  const targets = TARGETS.filter((t) => t.key === only);
  if (!targets.length) throw new Error(`no target matched --only=${only}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch();
  const manifest = { capturedAt: new Date().toISOString(), viewport: STRIP_PHONE.viewport, shots: {} };

  for (const t of targets) {
    console.log(`\n=== ${t.key} strip shots @ ${STRIP_PHONE.viewport.width}x${STRIP_PHONE.viewport.height}`);
    const rec = {};

    rec.mobile = await captureHero(browser, {
      ...STRIP_PHONE, url: t.url, measure: true,
      outFile: path.join(OUT_DIR, `${t.slug}-mobile-strip.jpg`),
    });
    console.log(`  ours   : ${rec.mobile.ok ? `${Math.round(rec.mobile.bytes / 1024)}KB` : "FAILED " + rec.mobile.error}`);

    if (t.current) {
      rec.currentMobile = await captureHero(browser, {
        ...STRIP_PHONE, url: t.current, measure: true,
        outFile: path.join(OUT_DIR, `${t.slug}-current-mobile-strip.jpg`),
      });
      console.log(`  theirs : ${rec.currentMobile.ok ? `${Math.round(rec.currentMobile.bytes / 1024)}KB` : "FAILED (strip will be OMITTED, not faked) " + rec.currentMobile.error}`);
    }

    // Say plainly whether the pair is usable. A one-sided strip is never shipped.
    const pair = rec.mobile && rec.mobile.ok && rec.currentMobile && rec.currentMobile.ok;
    console.log(`  pair usable: ${pair ? "YES" : "NO — the above-the-fold strip will be omitted"}`);
    manifest.shots[t.key] = { slug: t.slug, liveUrl: t.url, currentUrl: t.current || null, ...rec };
  }

  await browser.close();
  const out = path.join(OUT_DIR, "strip-manifest.json");
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest -> ${out}`);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
