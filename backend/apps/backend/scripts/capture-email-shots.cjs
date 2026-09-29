"use strict";
// scripts/capture-email-shots.cjs
// -----------------------------------------------------------------------------
// Renders each mirror slug with a REAL browser and saves above-the-fold hero
// shots for embedding directly inside the outreach email.
//
// WHY THE SCROLL-THROUGH MATTERS (documented bug, do not reintroduce):
// an instant screenshot grabs the page in its pre-animation state — IntersectionObserver
// reveals never fire, so a stat counter that should read "85" is captured reading "0".
// We therefore scroll the whole document in small steps, let every observer fire,
// scroll back to the top, settle, and only THEN capture the viewport.
//
// Outputs (JPEG — email attachments must stay small; Gmail clips fat messages):
//   <slug>-desktop.jpg        1200x900  above-the-fold hero of the NEW mirror
//   <slug>-mobile.jpg          390x844  above-the-fold hero of the NEW mirror
//   <slug>-current.jpg        1200x900  the client's CURRENT live site ("before"), if reachable
//   <slug>-current-mobile.jpg  390x844  the client's CURRENT live site on a PHONE
//   manifest.json             what was captured, from what URL, at what time
//
// THE MOBILE BEFORE/AFTER (the point of the -current-mobile shot):
// the two phone shots are the most persuasive honest thing we can send, so the
// capture has to be scrupulously symmetric or it is a lie told with pixels.
// BOTH phone shots go through the IDENTICAL code path: same viewport
// (390x844, isMobile, hasTouch, deviceScaleFactor 2), same iPhone user agent,
// same networkidle + font-ready wait, same scroll-through, same return-to-top
// assertion, same settle delay, same JPEG quality, same fullPage:false height.
// Nothing is blocked, no cookie banner or interstitial is dismissed, neither is
// scrolled to a flattering position, and neither is cropped. If the client's
// current site fails to load, we capture NOTHING and the strip is omitted —
// a failed load is never presented as "their site".
//
// We also take three measurements in the live page at 390px, on both sites
// identically, so the email can state a fact instead of an opinion:
//   horizontalOverflow  documentElement.scrollWidth > innerWidth (pinch-to-scroll)
//   viewportMeta        whether the page declares a mobile viewport at all
//   smallTapTargets     visible links/buttons whose box is under 24px
// These are reported as measurements. We do not score, rank or editorialise.
//
// TRUTH LAW: these are photographs of real pages at a real URL. Nothing is
// composited, retouched, or synthesized. If a capture fails, it is recorded as
// failed and the email simply omits that panel — we never substitute a stand-in.
// -----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

const PLAYWRIGHT = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/apps/backend/node_modules/playwright";
const OUT_DIR = "C:/Users/Main/Documents/Dark Signal/mirror-engine-lane/artifacts/ramon-qa/email-shots";

const DESKTOP = { width: 1200, height: 900 };
const MOBILE = { width: 390, height: 844 };

// One knob for BOTH phone shots. Changing it changes before and after together,
// which is the only way it is allowed to be changed.
const PHONE_SHOT = {
  viewport: MOBILE,
  isMobile: true,
  deviceScaleFactor: 2,   // retina — the strip is viewed on phones
  quality: 62,            // identical for before and after
};

// Slug -> what to shoot. `current` is the prospect's existing website (the honest
// "before"); omit it and the before/after strip is simply not rendered.
const TARGETS = [
  {
    key: "ramon",
    slug: "wss-test-ramon-roofing-fort-worth",
    url: "https://wss-test-ramon-roofing-fort-worth.wss-ai.com/",
    current: "https://www.ramonroofing.com/",
  },
  { key: "lyons", slug: "wss-test-lyons-roofing-tucson", url: "https://wss-test-lyons-roofing-tucson.wss-ai.com/" },
  { key: "musiccity", slug: "wss-test-music-city-roofers-nashville", url: "https://wss-test-music-city-roofers-nashville.wss-ai.com/" },
  { key: "kingdom", slug: "wss-test-kingdom-plumbing-las-vegas", url: "https://wss-test-kingdom-plumbing-las-vegas.wss-ai.com/" },
  { key: "enco", slug: "wss-test-enco-plumbing-the-colony", url: "https://wss-test-enco-plumbing-the-colony.wss-ai.com/" },
];

/**
 * Load a page, drive every scroll-triggered animation to completion, return to
 * the top, and capture the above-the-fold hero.
 */
async function captureHero(browser, { url, viewport, isMobile, outFile, quality, deviceScaleFactor, measure }) {
  const ctx = await browser.newContext({
    viewport,
    isMobile: !!isMobile,
    hasTouch: !!isMobile,
    deviceScaleFactor: deviceScaleFactor || 1,
    userAgent: isMobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});

    // --- the scroll-through. Small steps so IntersectionObserver thresholds and
    // count-up animations actually fire, instead of being frozen at their zero state.
    const total = await page.evaluate(() => document.body.scrollHeight);
    const step = Math.max(200, Math.floor(viewport.height / 3));
    for (let y = 0; y < total; y += step) {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(110);
    }
    // Settle at the bottom so late observers fire, then come home.
    await page.waitForTimeout(400);

    // Coming home is NOT a one-liner: `scroll-behavior:smooth` turns scrollTo(0,0)
    // into a multi-second animation, and the screenshot lands mid-flight with the
    // hero headline scrolled off the top. Kill smooth scrolling, then poll to 0.
    await page.addStyleTag({ content: "html,body,*{scroll-behavior:auto !important}" }).catch(() => {});
    for (let i = 0; i < 25; i++) {
      const y = await page.evaluate(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        return window.scrollY || document.documentElement.scrollTop || 0;
      });
      if (y === 0) break;
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(900);
    const restY = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop || 0);
    if (restY !== 0) throw new Error(`scroll never returned to top (scrollY=${restY}) — refusing to ship a cropped hero`);

    // Freeze looping motion so the hero is captured on a clean frame, not mid-blur.
    await page.evaluate(() => {
      document.querySelectorAll("video").forEach((v) => {
        try { v.pause(); } catch (_) {}
      });
    }).catch(() => {});
    await page.waitForTimeout(200);

    // --- honest measurement, taken in the live page at this exact viewport.
    // Identical code runs against the client's site and ours; whatever it says,
    // it says. We never adjust the probe to produce a more flattering delta.
    let metrics = null;
    if (measure) {
      metrics = await page.evaluate(() => {
        const de = document.documentElement;
        const meta = document.querySelector('meta[name="viewport"]');
        // A tap target is "small" only if it is actually visible and actually
        // interactive; hidden nav drawers and 0x0 nodes must not be counted.
        let small = 0, total = 0;
        for (const el of document.querySelectorAll("a[href],button,input,select,textarea,[role=button]")) {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
          total++;
          if (r.width < 24 || r.height < 24) small++;
        }
        // Consent/cookie overlays are NOT dismissed — a first-time visitor really
        // does see them. But an overlay eating half the "before" shot while our
        // page has none is an unearned advantage, so we MEASURE its coverage and
        // record it. The operator decides; the capture never quietly benefits.
        let overlayPct = 0, overlayText = null;
        const vpArea = window.innerWidth * window.innerHeight;
        for (const el of document.querySelectorAll("div,section,aside,dialog,[role=dialog]")) {
          const cs = getComputedStyle(el);
          if (cs.position !== "fixed" && cs.position !== "sticky") continue;
          if (cs.visibility === "hidden" || cs.display === "none") continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const t = (el.innerText || "").slice(0, 400);
          if (!/cookie|consent|gdpr|privacy|accept all|we use/i.test(t)) continue;
          const pct = Math.round((r.width * r.height) / vpArea * 100);
          if (pct > overlayPct) { overlayPct = pct; overlayText = t.replace(/\s+/g, " ").slice(0, 90); }
        }

        return {
          consentOverlayPctOfViewport: overlayPct,
          consentOverlayText: overlayText,
          scrollWidth: de.scrollWidth,
          innerWidth: window.innerWidth,
          horizontalOverflow: de.scrollWidth > window.innerWidth,
          overflowPx: Math.max(0, de.scrollWidth - window.innerWidth),
          viewportMeta: meta ? meta.getAttribute("content") : null,
          tapTargetsVisible: total,
          tapTargetsUnder24px: small,
          documentHeight: de.scrollHeight,
        };
      }).catch(() => null);
    }

    await page.screenshot({ path: outFile, type: "jpeg", quality: quality || 74, fullPage: false });
    const bytes = fs.statSync(outFile).size;
    await ctx.close();
    return { ok: true, url, file: outFile, bytes, viewport, deviceScaleFactor: deviceScaleFactor || 1, quality: quality || 74, pageErrors: errors.length, metrics };
  } catch (e) {
    await ctx.close().catch(() => {});
    return { ok: false, url, error: String(e.message).slice(0, 200) };
  }
}

async function main() {
  const only = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
  const targets = only ? TARGETS.filter((t) => t.key === only) : TARGETS;
  if (!targets.length) throw new Error(`no target matched --only=${only}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch();

  const manifest = { capturedAt: new Date().toISOString(), shots: {} };

  for (const t of targets) {
    const rec = {};
    console.log(`\n=== ${t.key} (${t.url})`);

    rec.desktop = await captureHero(browser, {
      url: t.url, viewport: DESKTOP, isMobile: false,
      outFile: path.join(OUT_DIR, `${t.slug}-desktop.jpg`), quality: 74,
    });
    console.log(`  desktop : ${rec.desktop.ok ? `${Math.round(rec.desktop.bytes / 1024)}KB (js errors: ${rec.desktop.pageErrors})` : "FAILED " + rec.desktop.error}`);

    // --- the "after" phone shot. Spread from PHONE_SHOT so it cannot drift
    // away from the "before" phone shot below.
    rec.mobile = await captureHero(browser, {
      ...PHONE_SHOT, url: t.url, measure: true,
      outFile: path.join(OUT_DIR, `${t.slug}-mobile.jpg`),
    });
    console.log(`  mobile  : ${rec.mobile.ok ? `${Math.round(rec.mobile.bytes / 1024)}KB (js errors: ${rec.mobile.pageErrors})` : "FAILED " + rec.mobile.error}`);

    if (t.current) {
      rec.current = await captureHero(browser, {
        url: t.current, viewport: DESKTOP, isMobile: false,
        // Shown small inside a before/after strip — no reason to pay full quality for it.
        outFile: path.join(OUT_DIR, `${t.slug}-current.jpg`), quality: 55,
      });
      console.log(`  current : ${rec.current.ok ? `${Math.round(rec.current.bytes / 1024)}KB` : "FAILED (before/after strip will be omitted) " + rec.current.error}`);

      // --- the "before" phone shot. Same spread, same everything.
      rec.currentMobile = await captureHero(browser, {
        ...PHONE_SHOT, url: t.current, measure: true,
        outFile: path.join(OUT_DIR, `${t.slug}-current-mobile.jpg`),
      });
      if (rec.currentMobile.ok) {
        const m = rec.currentMobile.metrics || {};
        console.log(`  cur-mob : ${Math.round(rec.currentMobile.bytes / 1024)}KB  scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth} overflow=${m.horizontalOverflow} viewportMeta=${m.viewportMeta ? "yes" : "NONE"} tapTargets<24px=${m.tapTargetsUnder24px}/${m.tapTargetsVisible}`);
        if (m.consentOverlayPctOfViewport > 10) {
          console.log(`  ** FAIRNESS NOTE: a consent overlay covers ${m.consentOverlayPctOfViewport}% of their "before" shot ("${m.consentOverlayText}").`);
          console.log(`     It is left in place because a first-time visitor really sees it — but it is NOT evidence about their design.`);
        }
      } else {
        console.log(`  cur-mob : FAILED (mobile before/after strip will be OMITTED, not faked) ${rec.currentMobile.error}`);
      }
      if (rec.mobile.ok && rec.mobile.metrics) {
        const m = rec.mobile.metrics;
        console.log(`  ours-mob: scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth} overflow=${m.horizontalOverflow} viewportMeta=${m.viewportMeta ? "yes" : "NONE"} tapTargets<24px=${m.tapTargetsUnder24px}/${m.tapTargetsVisible}`);
      }
    }

    manifest.shots[t.key] = { slug: t.slug, liveUrl: t.url, currentUrl: t.current || null, ...rec };
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest -> ${path.join(OUT_DIR, "manifest.json")}`);
}

// Exported so capture-strip-shots.cjs can take the SHORTER email-strip phone
// thumbnails through this exact code path — same context flags, same UA, same
// scroll-through, same return-to-top assertion, same quality — instead of
// forking a second capture implementation that could drift out of symmetry.
// The strip capture only ever changes viewport HEIGHT, and it changes it for
// BOTH phones at once, which is the only way it is allowed to change.
module.exports = { captureHero, PHONE_SHOT, TARGETS, OUT_DIR, DESKTOP, MOBILE };

if (require.main === module) {
  main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
}
