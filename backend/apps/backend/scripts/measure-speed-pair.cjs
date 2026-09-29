"use strict";
// scripts/measure-speed-pair.cjs — the load-time badges for the before/after strip.
//
// WHY THIS IS BUILT THE WAY IT IS
// A speed comparison is the single most checkable claim in the whole email: the
// prospect can open their own site on their own phone and see whether we were
// honest. So both sites are measured by the SAME tool, at the SAME viewport,
// under the SAME network throttle, over the SAME number of runs, and we take
// the MEDIAN of each — never our best run against their worst.
//
// The metric is Largest Contentful Paint: the moment the main content actually
// appears. It is the closest thing to "how long until I can see the page", it
// is what a normal person perceives as speed, and it is one of the Core Web
// Vitals Google ranks on — so the layman's line and the technical claim agree.
//
// RULES ENCODED HERE, NOT LEFT TO JUDGEMENT:
//   · Identical conditions for both sites, or no comparison is emitted.
//   · Median of N runs, not best-of.
//   · If their site fails to load, we emit NOTHING rather than score a failure.
//   · If the gap is under 2x, we emit NOTHING — a marginal difference dressed
//     up as a win is the kind of overclaim that loses the room.
//   · No adjectives about their site. A measurement, or silence.

const { chromium } = require("../node_modules/playwright");

const RUNS = 3;

// THROTTLING IS OFF BY DEFAULT — deliberately.
//
// The first version of this ran a 1.6 Mbps / 150ms / 4x-CPU preset (cheap phone
// on bad 4G) and reported Ramon's site at 21.8s vs our 2.4s. The owner
// immediately called it: "their site cannot really have taken twenty something
// seconds." He was right. Unthrottled, the same pair measures 1.5s vs 0.5s LCP
// and 3.7s vs 0.4s to full load.
//
// Both figures are honest, but the throttled one is the WORST case, not the
// typical one — and a prospect who loads their own site on office wifi and sees
// 3 seconds, not 22, stops believing everything else in the email. At 500
// mirrors, the overstating version is a liability. Default to typical
// conditions; SPEED_THROTTLE=1 opts into the slow-phone scenario.
const USE_THROTTLE = /^(1|true|yes)$/i.test(String(process.env.SPEED_THROTTLE || ""));
const THROTTLE = { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 };
const VIEWPORT = { width: 390, height: 844 };

async function measureOnce(browser, url) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  if (USE_THROTTLE) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...THROTTLE });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  let lcp = null, failed = false, weight = null, requests = null;
  try {
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lcp = Math.max(window.__lcp, e.renderTime || e.loadTime || e.startTime);
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    const res = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    if (!res || res.status() >= 400) failed = true;
    await page.waitForTimeout(2500); // let late LCP candidates settle
    const stats = await page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      return { lcp: Math.round(window.__lcp || 0), requests: res.length, kb: Math.round(res.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024) };
    });
    lcp = stats.lcp; weight = stats.kb; requests = stats.requests;
    if (!lcp) failed = true;
  } catch {
    failed = true;
  }
  await ctx.close();
  return failed ? null : { lcp, weight, requests };
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};

/** Human phrasing. Sub-second reads better as "half a second" than "0.32s". */
function plain(ms) {
  const s = ms / 1000;
  if (s < 0.6) return "under half a second";
  if (s < 1.1) return "about a second";
  return `about ${s < 10 ? s.toFixed(1) : Math.round(s)} seconds`;
}

async function measurePair({ currentUrl, mirrorUrl }) {
  const browser = await chromium.launch();
  try {
    const cur = [], mir = [];
    for (let i = 0; i < RUNS; i++) {
      cur.push(await measureOnce(browser, currentUrl));
      mir.push(await measureOnce(browser, mirrorUrl));
    }
    const curOk = cur.filter((x) => x != null);
    const mirOk = mir.filter((x) => x != null);

    // Fail closed on either side. A comparison needs two honest measurements.
    if (curOk.length < 2) {
      return { emit: false, reason: `their site did not load reliably (${curOk.length}/${RUNS} runs) — no comparison shown` };
    }
    if (mirOk.length < 2) {
      return { emit: false, reason: `our mirror did not measure reliably (${mirOk.length}/${RUNS} runs) — no comparison shown` };
    }

    const currentMs = median(curOk.map(x=>x.lcp));
    const mirrorMs = median(mirOk.map(x=>x.lcp));
    const factor = currentMs / mirrorMs;

    // TWO gates, and BOTH must pass. A ratio alone is not a story.
    //
    // Ramon's site measures 1.42s — genuinely fast. The ratio gate happily
    // passed it at 4.6x, which is true and completely unpersuasive: the owner
    // loaded his own site on his phone, saw it snap in, and rightly stopped
    // believing the number. A business whose site is already fast does not have
    // a speed problem, however good ours looks next to it.
    //
    // So the site must be slow in ABSOLUTE terms before we say anything. 2.5s
    // is the point where a normal person starts to feel the wait.
    const SLOW_ENOUGH_MS = 2500;
    if (currentMs < SLOW_ENOUGH_MS) {
      return { emit: false, currentMs, mirrorMs, factor,
        reason: `their site loads in ${(currentMs / 1000).toFixed(2)}s — genuinely fast. No speed claim is made regardless of the ${factor.toFixed(1)}x ratio, because they do not have a speed problem and would know it.` };
    }
    if (factor < 2) {
      return { emit: false, currentMs, mirrorMs, factor,
        reason: `only ${factor.toFixed(1)}x faster — below the 2x bar, so no speed claim is made` };
    }

    return {
      emit: true, currentMs, mirrorMs,
      factor: Number(factor.toFixed(1)),
      currentLabel: plain(currentMs),
      mirrorLabel: plain(mirrorMs),
      // The layman's line. Google's own ranking signal, said without jargon.
      plainEnglish: `${factor.toFixed(1)}x faster to show your main content. Google measures this too — it is one of the things that decides where you land in local results.`,
      weight: { currentKb: curOk[0].weight, mirrorKb: mirOk[0].weight, currentRequests: curOk[0].requests, mirrorRequests: mirOk[0].requests },
      method: `Largest Contentful Paint, median of ${RUNS} runs, both sites measured identically at ${VIEWPORT.width}x${VIEWPORT.height}${USE_THROTTLE ? " on a throttled mobile connection (1.6 Mbps, 150ms latency, 4x CPU)" : " on a normal connection"}.`,
    };
  } finally {
    await browser.close();
  }
}

/** Small badge that sits above each screenshot in the before/after strip. */
function speedBadge(ms, label, tone) {
  const bg = tone === "slow" ? "#fbeaea" : "#e9f5ee";
  const fg = tone === "slow" ? "#8a1c1c" : "#0f7b3f";
  return `<div style="display:inline-block;background:${bg};color:${fg};border-radius:999px;padding:4px 11px;font:700 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;margin-bottom:7px">
    ⏱ ${(ms / 1000).toFixed(ms < 1000 ? 2 : 1)}s — ${label}
  </div>`;
}

module.exports = { measurePair, speedBadge, plain };

if (require.main === module) {
  const [currentUrl, mirrorUrl] = process.argv.slice(2);
  if (!currentUrl || !mirrorUrl) { console.error("usage: measure-speed-pair.cjs <currentUrl> <mirrorUrl>"); process.exit(2); }
  measurePair({ currentUrl, mirrorUrl }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.emit ? 0 : 1);
  }).catch((e) => { console.error("FAILED:", e.message); process.exit(2); });
}
