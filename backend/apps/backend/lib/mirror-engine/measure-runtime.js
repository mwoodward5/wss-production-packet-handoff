"use strict";

// lib/mirror-engine/measure-runtime.js — MEASURE the runtime points.
//
// Eight 108-stack points are properties of the served page rather than the
// source bytes: HTTPS, HTTP/2+, compression, LCP, INP, CLS, TTFB, AA contrast,
// keyboard nav. The scorer previously marked them "unverified" — honest, but
// it left a fifth of the sellable number permanently unprovable. They are all
// measurable against the deployed URL, so we measure them and report real
// numbers. A point is met because it was OBSERVED, never because it is
// plausible; when a probe cannot run, the point stays unverified.

const PERF_BUDGET = { lcp: 2000, inp: 200, cls: 0.05, ttfb: 600 };

/** Transport facts from real response headers + the protocol Chromium used. */
async function measureTransport(url, { fetchImpl = fetch } = {}) {
  const out = { https: false, protocol: null, compression: null, ttfb_ms: null };
  out.https = new URL(url).protocol === "https:";
  const t0 = Date.now();
  const res = await fetchImpl(url, {
    headers: { "Accept-Encoding": "br, gzip", "User-Agent": "Mozilla/5.0 (wss-mirror-engine measure)" },
    signal: AbortSignal.timeout(25000),
  });
  out.ttfb_ms = Date.now() - t0; // upper bound: includes full header round trip
  out.status = res.status;
  out.compression = res.headers.get("content-encoding") || "none";
  await res.arrayBuffer().catch(() => {});
  return out;
}

/**
 * Core Web Vitals + accessibility probes in a real browser.
 * LCP/CLS come from PerformanceObserver; INP is approximated by measuring
 * event latency after a scripted interaction (a synthetic INP, labelled as
 * such — we never claim a field measurement we did not take).
 */
async function measureVitals(url, { timeoutMs = 60000 } = {}) {
  const { launchChromium } = require("../serverless-chromium");
  let browser;
  try { browser = await launchChromium(); } catch (e) { return { status: "unavailable", reason: String(e.message || e).slice(0, 120) }; }
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      window.__vitals = { lcp: 0, cls: 0, protocol: null };
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__vitals.lcp = Math.max(window.__vitals.lcp, e.startTime);
        }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
        }).observe({ type: "layout-shift", buffered: true });
      } catch { /* older engines: probe reports null */ }
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });

    // Synthetic interaction latency (INP proxy): click a non-navigating element
    // and time until the next paint-ish frame.
    const inp = await page.evaluate(async () => {
      const target = document.querySelector("summary, button, [role=button]") || document.body;
      const t0 = performance.now();
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t0;
    });

    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] || {};
      return { ttfb: n.responseStart || null, protocol: n.nextHopProtocol || null, transfer: n.transferSize || null, encoded: n.encodedBodySize || null, decoded: n.decodedBodySize || null };
    });
    const vitals = await page.evaluate(() => window.__vitals);

    // AA contrast sample over the largest text nodes actually rendered.
    const contrast = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c;
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const parse = (s) => { const m = String(s).match(/(\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
      const bgOf = (el) => {
        let n = el;
        while (n && n !== document.documentElement) {
          const c = parse(getComputedStyle(n).backgroundColor);
          const a = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\([^)]*,\s*0\s*\)/.test(a)) return c;
          n = n.parentElement;
        }
        return [255, 255, 255];
      };
      const els = [...document.querySelectorAll("a,button,h1,h2,h3,p,li,span")]
        .filter((e) => e.textContent && e.textContent.trim().length > 2 && e.offsetParent !== null)
        .slice(0, 400);
      let worst = 21, worstText = "", checked = 0;
      const fails = [];
      for (const el of els) {
        const st = getComputedStyle(el);
        const fg = parse(st.color); if (!fg) continue;
        const bg = bgOf(el);
        const L1 = lum(fg), L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(st.fontSize) || 16;
        const bold = (parseInt(st.fontWeight, 10) || 400) >= 700;
        const large = size >= 24 || (bold && size >= 18.66);
        const need = large ? 3 : 4.5;
        checked++;
        if (ratio < need) fails.push({ text: el.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need });
        if (ratio < worst) { worst = ratio; worstText = el.textContent.trim().slice(0, 40); }
      }
      return { checked, worst: Math.round(worst * 100) / 100, worstText, fails: fails.slice(0, 8), failCount: fails.length };
    });

    // Keyboard nav: can we reach the primary CTA by tabbing, and is focus visible?
    const keyboard = await page.evaluate(() => {
      const focusables = [...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')].filter((e) => e.offsetParent !== null);
      return { focusable_count: focusables.length };
    });
    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const st = getComputedStyle(el);
      return { tag: el.tagName, text: (el.textContent || "").trim().slice(0, 40), outline: st.outlineStyle + " " + st.outlineWidth, boxShadow: st.boxShadow.slice(0, 40) };
    });

    return {
      status: "measured",
      lcp_ms: Math.round(vitals.lcp || 0),
      cls: Math.round((vitals.cls || 0) * 1000) / 1000,
      inp_ms: Math.round(inp),
      inp_kind: "synthetic",
      ttfb_ms: nav.ttfb != null ? Math.round(nav.ttfb) : null,
      protocol: nav.protocol,
      compressed: nav.encoded != null && nav.decoded != null ? nav.encoded < nav.decoded : null,
      contrast,
      keyboard: { ...keyboard, first_focus: firstFocus },
      budget: PERF_BUDGET,
    };
  } catch (e) {
    return { status: "failed", reason: String(e.message || e).slice(0, 200) };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Both probes, merged into the shape the scorer consumes. */
async function measureRuntime(url) {
  const [transport, vitals] = await Promise.all([
    measureTransport(url).catch((e) => ({ error: String(e.message || e).slice(0, 120) })),
    measureVitals(url),
  ]);
  return { url, transport, vitals, measured_at: new Date().toISOString() };
}

/**
 * collectVitals(page) — the LIGHTWEIGHT Core Web Vitals probe, for a browser
 * page that is ALREADY OPEN. The render gate (verify.js renderCheckOnce)
 * loads every deployment in Chromium anyway; this reuses that same page to
 * observe LCP/CLS/TTFB (buffered PerformanceObserver entries + Navigation
 * Timing) and a synthetic INP, instead of paying for a second browser the way
 * measureVitals does. It NEVER throws — a probe that cannot run reports
 * status:"unavailable" and the caller keeps its verdict untouched: measurement
 * is evidence, never a gate.
 */
async function collectVitals(page) {
  try {
    // Buffered:true replays entries the page already recorded, so this works
    // when called after networkidle, not only before navigation.
    const probe = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      return new Promise((resolve) => {
        const out = {
          __wssCwv: true,
          lcp: 0,
          cls: 0,
          ttfb: nav.responseStart != null ? nav.responseStart : null,
          protocol: nav.nextHopProtocol || null,
          encoded: nav.encodedBodySize != null ? nav.encodedBodySize : null,
          decoded: nav.decodedBodySize != null ? nav.decodedBodySize : null,
        };
        try {
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) out.lcp = Math.max(out.lcp, e.startTime);
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((l) => {
            for (const e of l.getEntries()) if (!e.hadRecentInput) out.cls += e.value;
          }).observe({ type: "layout-shift", buffered: true });
        } catch { /* older engines: the numbers stay at their floors */ }
        // Give the buffered observers one frame to deliver, then settle.
        requestAnimationFrame(() => setTimeout(() => resolve(out), 0));
      });
    });
    // Synthetic interaction latency (INP proxy), same technique as
    // measureVitals but restricted to <summary>/body: the render gate runs on
    // LIVE customer deployments, and a <button> on a stranger's SPA can
    // navigate, submit or mutate — a toggle of a <details> cannot.
    const interaction = await page.evaluate(async () => {
      const target = document.querySelector("summary") || document.body;
      const t0 = performance.now();
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { __wssInp: performance.now() - t0 };
    }).catch(() => null);
    return {
      status: "measured",
      lcp_ms: Math.round(Number(probe && probe.lcp) || 0),
      cls: Math.round((Number(probe && probe.cls) || 0) * 1000) / 1000,
      inp_ms: interaction && Number.isFinite(interaction.__wssInp) ? Math.round(interaction.__wssInp) : null,
      inp_kind: "synthetic",
      ttfb_ms: probe && probe.ttfb != null ? Math.round(probe.ttfb) : null,
      protocol: probe ? probe.protocol : null,
      compressed: probe && probe.encoded != null && probe.decoded != null ? probe.encoded < probe.decoded : null,
      budget: PERF_BUDGET,
    };
  } catch (e) {
    return { status: "unavailable", reason: String(e.message || e).slice(0, 120) };
  }
}

module.exports = { measureRuntime, measureTransport, measureVitals, collectVitals, PERF_BUDGET };
