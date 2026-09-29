"use strict";

// lib/mirror-engine/verify.js — rendered verification (acceptance test 7).
//
// "Source-level checks pass while all of this ships. Fetch the deployed asset
// and diff it, or you do not know." — the byte diff lives in deploy.js; this
// file is the RENDERED check: load the deployed page in a real browser with a
// network-failure trap. 0 failed requests, 0 console errors, and when the
// donor ships a hero video: readyState === 4 && !paused. Test 7 is the one
// that catches "it looks flat".
//
// Playwright is a repo dependency but not guaranteed runnable in every
// serverless instance. When chromium cannot launch, the check reports
// status:"unavailable" — which keeps revealable FALSE. Unverifiable is not
// verified; nothing becomes emailable without a real render pass.

const { residualEntities } = require("./html-entities");
const { launchChromium } = require("../serverless-chromium");
const { composeAbortSignal, remainingBudget } = require("./deploy");
const { collectVitals } = require("./measure-runtime");
const { donorBaselineCacheIdentity } = require("./donor");
const { cachedBaselineTargets, storeBaselineTargets } = require("./baseline-cache");

function renderLimits({ signal, deadlineAt, timeoutMs = 45_000 } = {}) {
  const remaining = remainingBudget(deadlineAt);
  const boundedTimeout = Math.max(1, Math.min(Number(timeoutMs) || 45_000, remaining));
  // Playwright keeps its existing local timeout. The composed signal carries
  // only the caller/deadline boundary, so orchestration cannot turn a normal
  // retryable navigation timeout into a caller cancellation.
  const combined = composeAbortSignal({ signal, deadlineAt });
  if (combined && combined.aborted) throw combined.reason || Object.assign(new Error("render aborted"), { name: "AbortError" });
  return { signal: combined, timeoutMs: boundedTimeout };
}

/**
 * Bound an in-page promise by wall clock.
 *
 * page.evaluate has no timeout of its own: if the injected script never
 * settles, the await never returns and the caller's whole budget is consumed.
 * That is exactly how the hero-video poll stalled every build. Anything we run
 * inside the page that is EVIDENCE (not a gate) gets a ceiling, and a miss
 * degrades to a named fallback instead of hanging.
 */
function withPageTimeout(work, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(work).then((v) => { clearTimeout(timer); return v; }),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), Math.max(1, ms)); }),
  ]);
}

function abortRace(work, signal) {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(signal.reason || Object.assign(new Error("render aborted"), { name: "AbortError" }));
  return Promise.race([
    work,
    new Promise((_, reject) => signal.addEventListener("abort", () => {
      reject(signal.reason || Object.assign(new Error("render aborted"), { name: "AbortError" }));
    }, { once: true })),
  ]);
}

async function launchWithAbort(launch, signal) {
  const pending = Promise.resolve().then(() => launch());
  try {
    return await abortRace(pending, signal);
  } catch (e) {
    // Abort can beat a serverless Chromium extraction which cannot itself be
    // cancelled. If it eventually opens, close it immediately so the timed-out
    // caller does not leak a browser process into the warm worker.
    pending.then((lateBrowser) => {
      if (lateBrowser && typeof lateBrowser.close === "function") lateBrowser.close().catch(() => {});
    }).catch(() => {});
    throw e;
  }
}

/** How long a hero video gets to reach readyState 4 before it is called broken. */
const HERO_VIDEO_WAIT_MS = 6000;

// ---------------------------------------------------------------------------
// A CUSTOMER'S ANALYTICS TAG IS NOT A BROKEN SITE
// ---------------------------------------------------------------------------
// MEASURED 2026-08-11, wss-test-rimrock-plumbing-billings. The customer asked
// Riley for Google Analytics; the tag installed, deployed and fires correctly
// in a real browser. The next rebuild then REFUSED:
//
//   mirror_build_not_revealable [render=failed] —
//   render: failed_requests:2 | console_errors:2
//
// The same deployment, opened from a normal network moments later: zero failed
// requests, zero console errors, gtag live, dataLayer populated. The two
// failures were googletagmanager.com and google-analytics.com, unreachable
// from inside the build's serverless Chromium — and each one was counted
// twice, once as a dead request and once as the console error the browser logs
// about it.
//
// So the gate was reading its own sandbox's network and calling it the
// customer's page. Left alone it means: ask for analytics, and your site can
// never be rebuilt again. Every fix after that date would stop at your door.
//
// The exemption is deliberately narrow — ONLY the hosts our own tracking-tag
// op can install, listed in lib/site-change-plan.js TRACKING_VENDORS.origins,
// plus the collector each loader posts to. We put those hosts in the page, we
// know exactly what they are, and a visitor sees nothing when they fail. Any
// OTHER third-party failure — a photo on someone else's CDN, a font, a map —
// is still fatal, because a visitor would see that one.
const TAG_VENDOR_HOSTS = Object.freeze([
  "www.googletagmanager.com",
  "www.google-analytics.com",
  "analytics.google.com",
  "region1.google-analytics.com",
  "connect.facebook.net",
  "www.facebook.com",
  "www.clarity.ms",
  "c.clarity.ms",
  "c.bing.com",
]);

/**
 * True when this URL — or this console-error text, which carries the URL —
 * names one of those hosts. Matching on host boundaries, never a substring:
 * "www.google-analytics.com.evil.test" must not be exempt.
 */
function isTagVendorUrl(value) {
  const text = String(value || "");
  return TAG_VENDOR_HOSTS.some((host) =>
    new RegExp(`https?://${host.replace(/\./g, "\\.")}(?=[/:?#]|$)`, "i").test(text));
}

// ---------------------------------------------------------------------------
// WHICH FAILURES ARE WORTH RE-RENDERING
// ---------------------------------------------------------------------------
// A re-render can only change a verdict that depended on TIMING or on the
// browser itself: a launch that lost the /tmp extraction race, a goto that
// timed out while four siblings fought for the same vCPU, a hero video that had
// not reached readyState 4 yet, a request that failed once.
//
// It can never change a property of the deployed BYTES. A raw {{TOKEN}} in the
// text, an &#038; a visitor can read, two paths rendering the identical page, a
// missing #anchor, broken prose, injected content that is not in the DOM — all
// of those are the same on the tenth render as on the first. Retrying them
// would only burn a browser and delay an honest casualty.
//
// So this list is the ONLY thing that decides whether a second look happens.
// Nothing here weakens a verdict: the retry re-measures the same page with the
// same rules, and the SECOND verdict is the one that stands.
const STATIC_PROBLEM = /^(rendered_raw_tokens|entity_residue_in_rendered_text|route_collisions|missing_hash_targets|broken_prose|injected_content_|non_200_paths|empty_rendered_body)/;

function worthRetrying(result) {
  if (!result) return true;
  if (result.status === "passed") return false;
  if (result.status === "unavailable") return true; // the browser never opened
  const problems = result.problems || [];
  if (!problems.length) return false;
  // Retry only when EVERY problem is one a re-render could plausibly clear.
  return problems.every((p) => !STATIC_PROBLEM.test(String(p)));
}

/**
 * Run a browser-backed check, and give it a second chance when — and only when
 * — the first verdict was the kind a re-render can change. The returned verdict
 * is always the LAST attempt's, with the first attempt recorded as evidence so
 * a flake is visible in the manifest instead of being quietly smoothed over.
 */
async function withOneRetry(label, run) {
  const first = await run();
  if (!worthRetrying(first)) return first;
  const second = await run();
  return {
    ...second,
    attempts: 2,
    retried: label,
    first_attempt: {
      status: first.status,
      ...(first.reason ? { reason: first.reason } : {}),
      ...(first.problems ? { problems: first.problems.slice(0, 6) } : {}),
    },
  };
}

function classifyPageErrors(errors = [], recovery = {}) {
  const fatal = [];
  const recovered = [];
  const recoveredDom = Number(recovery.bodyChars || 0) >= 180
    && Number(recovery.rootChildren || 0) >= 1
    && recovery.h1Visible === true
    && Number(recovery.interactiveCount || 0) >= 1;
  for (const raw of errors || []) {
    const error = String(raw || "");
    if (/Minified React error #418\b/.test(error) && recoveredDom) recovered.push(error);
    else fatal.push(error);
  }
  return { fatal, recovered, recovery: { ...recovery, recoveredDom } };
}

// Runs inside Chromium via page.evaluate. Background colours are often
// translucent (hero glass and scrims). Treating rgba() as opaque made
// a readable white headline on a dark hero look like white-on-white to the
// release gate. Composite every ancestor background over the browser canvas so
// the proof measures the colour the headline is actually painted against.
function measureThemeHeadlineContrast(nextMode) {
  const root = document.documentElement;
  root.setAttribute("data-wss-theme", nextMode);
  root.classList.toggle("dark", nextMode === "dark");
  const rgba = (value) => {
    const match = String(value || "").match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?/i);
    if (!match) return null;
    const alpha = match[4] == null ? 1 : (String(match[4]).endsWith("%") ? Number.parseFloat(match[4]) / 100 : Number(match[4]));
    return [Number(match[1]), Number(match[2]), Number(match[3]), Math.max(0, Math.min(1, alpha))];
  };
  const composite = (front, back) => {
    if (!front || front[3] <= 0) return back;
    const alpha = front[3] + back[3] * (1 - front[3]);
    if (alpha <= 0) return [255, 255, 255, 1];
    return [
      (front[0] * front[3] + back[0] * back[3] * (1 - front[3])) / alpha,
      (front[1] * front[3] + back[1] * back[3] * (1 - front[3])) / alpha,
      (front[2] * front[3] + back[2] * back[3] * (1 - front[3])) / alpha,
      alpha,
    ];
  };
  const luminance = (value) => {
    const lin = (part) => { const c = part / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(value[0]) + 0.7152 * lin(value[1]) + 0.0722 * lin(value[2]);
  };
  const h1 = document.querySelector("h1");
  const rect = h1 && h1.getBoundingClientRect();
  const style = h1 && getComputedStyle(h1);
  const lineage = [];
  for (let node = h1; node; node = node.parentElement) lineage.push(node);
  let background = [255, 255, 255, 1];
  for (const node of lineage.reverse()) {
    background = composite(rgba(getComputedStyle(node).backgroundColor), background);
  }
  const foregroundRaw = style ? rgba(style.color) : null;
  const foreground = foregroundRaw ? composite(foregroundRaw, background) : null;
  const contrast = foreground ? (() => {
    const a = luminance(foreground);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  })() : 0;
  const visible = Boolean(h1 && rect && rect.width > 1 && rect.height > 1 && style
    && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.01);
  return { visible, contrast: Number(contrast.toFixed(3)) };
}

async function renderCheckOnce(url, {
  timeoutMs = 45000, signal, deadlineAt, launch = launchChromium,
  preparePage, expectedLogoPath = "",
} = {}) {
  const bounded = renderLimits({ timeoutMs, signal, deadlineAt });
  let browser;
  try {
    browser = await launchWithAbort(launch, bounded.signal);
  } catch (e) {
    if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
    // The launcher's message now names BOTH attempts and both engines. Keep
    // room for it: truncating to 120 chars was how "chromium_launch_failed"
    // reached the operator with the cause sliced off the end.
    return { status: "unavailable", reason: `chromium_launch_failed: ${String(e.message || e).slice(0, 400)}` };
  }
  try {
    const page = await browser.newPage();
    const failedRequests = [];
    const abortedRequests = [];
    const thirdPartyTagFailures = [];
    const consoleErrors = [];
    const pageErrors = [];
    page.on("requestfailed", (req) => {
      const error = (req.failure() || {}).errorText || "";
      // net::ERR_ABORTED is not a broken asset — it is a request the page
      // itself cancelled. A relocated/late-armed iframe and page teardown both
      // produce it, and treating it as a failure failed identical builds at
      // random (observed: one mirror flunked the render gate on its map iframe,
      // then passed unchanged on retry). Recorded as evidence, never fatal;
      // a genuinely missing asset still surfaces as an HTTP 4xx/5xx below.
      if (/ERR_ABORTED/i.test(error)) {
        abortedRequests.push({ url: req.url().slice(0, 200), error });
        return;
      }
      if (isTagVendorUrl(req.url())) {
        thirdPartyTagFailures.push({ url: req.url().slice(0, 200), error });
        return;
      }
      failedRequests.push({ url: req.url().slice(0, 200), error });
    });
    page.on("response", (res) => {
      if (res.status() < 400) return;
      if (isTagVendorUrl(res.url())) {
        thirdPartyTagFailures.push({ url: res.url().slice(0, 200), error: `http_${res.status()}` });
        return;
      }
      failedRequests.push({ url: res.url().slice(0, 200), error: `http_${res.status()}` });
    });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = String(msg.text()).slice(0, 200);
      // The browser logs a console error for the same blocked script it just
      // reported as a failed request. Counting both made one unreachable tag
      // look like two separate site defects.
      if (isTagVendorUrl(text)) {
        thirdPartyTagFailures.push({ url: text, error: "console_error" });
        return;
      }
      consoleErrors.push(text);
    });
    // An UNCAUGHT exception is not a console message. Playwright routes it to
    // "pageerror", and listening only for "console" is why a React hydration
    // crash — the exact failure that leaves a mirror blank — never reached
    // problems[] and checks.render happily passed on a dead page. This is the
    // loudest signal the browser has; it must be fatal.
    page.on("pageerror", (err) => {
      const name = (err && err.name) || "Error";
      const message = String((err && err.message) || err);
      pageErrors.push(`${name}: ${message}`.slice(0, 200));
    });
    if (typeof preparePage === "function") {
      await abortRace(Promise.resolve().then(() => preparePage(page)), bounded.signal);
    }
    await abortRace(page.goto(url, { waitUntil: "networkidle", timeout: bounded.timeoutMs }), bounded.signal);

    // GIVE THE HERO A MOMENT — "not loaded yet" is not "not playing".
    //
    // `networkidle` fires 500ms after the last request STARTS going quiet; a
    // 1-2MB hero loop is still buffering then, and reading readyState at that
    // instant reports 0. Measured on the 2026-08-11 fleet rebuild: 15 mirrors
    // were refused as hero_video_not_playing (readyState=0 paused=true), and
    // wss-test-rocky-s-plumbing-chickamauga opened in a real browser moments
    // later reads readyState 4, paused false, zero failed requests, and its
    // /assets/hero.mp4 answers 206 video/mp4. The pages were fine; the gate
    // was early.
    //
    // So the video is POLLED to a verdict instead of sampled once. A hero that
    // genuinely never loads still fails — it simply gets the same few seconds a
    // visitor would give it before the check calls it broken.
    const videoPoll = page.evaluate(async (waitMs) => {
      const v = document.querySelector("video");
      if (!v) return { present: false };
      const deadline = Date.now() + waitMs;
      const settled = () => v.readyState === 4 && !v.paused;
      while (!settled() && Date.now() < deadline) {
        // Autoplay can be deferred by the browser; asking once is free and is
        // what a visitor's first interaction would do anyway.
        //
        // NEVER bare-await play(). HTMLMediaElement.play() returns a promise
        // that can NEVER settle — the browser is free to leave it pending while
        // it decides whether autoplay is allowed or while the media is still
        // loading. A bare await parks the loop inside that promise, so the
        // `Date.now() < deadline` guard above can never run again and this
        // evaluate hangs forever. Measured 2026-08-19: the render gate stopped
        // dead here on live video-hero mirrors, burned the whole ~270s build
        // budget, deferred, retried and exhausted — no site was ever produced.
        // Racing play() against a short timer keeps the poll honest: a hero
        // that really plays still settles, one that never does still fails.
        if (v.paused && v.muted) {
          try {
            await Promise.race([
              Promise.resolve(v.play()).catch(() => {}),
              new Promise((r) => setTimeout(r, 500)),
            ]);
          } catch { /* judged below */ }
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      return {
        present: true,
        readyState: v.readyState,
        paused: v.paused,
        waited_ms: waitMs - Math.max(0, deadline - Date.now()),
      };
    }, Math.min(HERO_VIDEO_WAIT_MS, bounded.timeoutMs));
    // Ceiling for the poll, independent of anything the page does. The poll
    // self-settles within its own waitMs; if the page stalls it anyway, the
    // hero is reported UNMEASURED and the build carries on, rather than
    // surrendering its entire budget to one <video> element.
    const video = await abortRace(
      withPageTimeout(
        videoPoll,
        Math.min(HERO_VIDEO_WAIT_MS, bounded.timeoutMs) + 4_000,
        { present: true, readyState: null, paused: null, waited_ms: null, unmeasured: "hero_video_poll_timeout" },
      ),
      bounded.signal,
    );
    const bodyText = await abortRace(
      page.evaluate(() => document.body ? document.body.innerText.slice(0, 20000) : ""),
      bounded.signal,
    );
    const rawTokens = (bodyText.match(/\{\{[A-Z_]+\}\}/g) || []).slice(0, 5);
    const hydrationRecovery = await abortRace(page.evaluate(() => {
      const root = document.getElementById("root");
      const h1 = document.querySelector("h1");
      const rect = h1 ? h1.getBoundingClientRect() : null;
      const style = h1 ? getComputedStyle(h1) : null;
      const h1Visible = Boolean(h1 && rect && rect.width > 1 && rect.height > 1
        && style && style.display !== "none" && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0.01);
      return {
        bodyChars: (document.body?.innerText || "").trim().length,
        rootChildren: root ? root.childElementCount : (document.body?.childElementCount || 0),
        h1Visible,
        interactiveCount: document.querySelectorAll("a[href],button,input,textarea,select,form").length,
      };
    }), bounded.signal);
    const logoIdentity = await abortRace(page.evaluate((expected) => {
      if (!expected) return { status: "unmeasured", reason: "expected_logo_path_missing" };
      const matches = (element) => {
        try { return new URL(element.currentSrc || element.src || "", location.href).pathname === expected; } catch { return false; }
      };
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 1 && rect.height > 1 && style.display !== "none"
          && style.visibility !== "hidden" && Number(style.opacity || 1) > 0.01;
      };
      const headerScope = "header img[src], [role='banner'] img[src], [class*='header' i] img[src], [class*='brand' i] img[src]";
      const footerScope = "footer img[src*='logo' i], footer [class*='brand' i] img[src], footer [class*='logo' i] img[src], [role='contentinfo'] img[src*='logo' i], [role='contentinfo'] [class*='brand' i] img[src]";
      const header = [...document.querySelectorAll(headerScope)].filter((node) => matches(node) && visible(node));
      const footerCandidates = [...document.querySelectorAll(footerScope)].filter(visible);
      const footerWrong = footerCandidates.some((node) => !matches(node));
      return {
        status: header.length && !footerWrong ? "passed" : "failed",
        header_matches: header.length,
        footer_candidates: footerCandidates.length,
        ...(footerWrong ? { reason: "footer_brand_identity_mismatch" } : {}),
      };
    }, expectedLogoPath), bounded.signal);
    // A manual WSS toggle owns the theme. Verify the four user-visible states
    // here, in the same browser proof that catches resource 404s and blank
    // heroes. This is intentionally narrow: headline visibility plus its
    // computed foreground/background contrast, not subjective styling.
    const themeModes = await (async () => {
      // Test harnesses that model only navigation do not expose Playwright's
      // viewport API. Production Chromium always does; retain the existing
      // harness contract without pretending it supplied visual evidence.
      if (typeof page.setViewportSize !== "function" || typeof page.emulateMedia !== "function") {
        return { status: "passed", toggle: false, modes: [], unmeasured: "viewport_or_media_api_unavailable" };
      }
      const togglePresent = await abortRace(page.evaluate(() => Boolean(document.querySelector("[data-wss-theme-toggle]"))), bounded.signal);
      if (!togglePresent) return { status: "passed", toggle: false, modes: [] };
      const original = await abortRace(page.evaluate(() => ({
        theme: document.documentElement.getAttribute("data-wss-theme"),
        dark: document.documentElement.classList.contains("dark"),
      })), bounded.signal);
      const modes = [];
      for (const os of ["light", "dark"]) {
        await abortRace(page.emulateMedia({ colorScheme: os }), bounded.signal);
        for (const viewport of [
          { name: "desktop", width: 1440, height: 900 },
          { name: "mobile", width: 390, height: 844 },
        ]) {
          await abortRace(page.setViewportSize({ width: viewport.width, height: viewport.height }), bounded.signal);
          for (const mode of ["light", "dark"]) {
            const proof = await abortRace(page.evaluate(measureThemeHeadlineContrast, mode), bounded.signal);
            modes.push({ os, viewport: viewport.name, mode, ...proof });
          }
        }
      }
      await abortRace(page.evaluate((saved) => {
        if (saved.theme == null) document.documentElement.removeAttribute("data-wss-theme");
        else document.documentElement.setAttribute("data-wss-theme", saved.theme);
        document.documentElement.classList.toggle("dark", saved.dark === true);
      }, original), bounded.signal);
      await abortRace(page.emulateMedia({ colorScheme: "light" }), bounded.signal);
      const failed = modes.filter(mode => !mode.visible || mode.contrast < 4.5);
      return { status: failed.length ? "failed" : "passed", toggle: true, modes, ...(failed.length ? { failed } : {}) };
    })();
    const pageErrorVerdict = classifyPageErrors(pageErrors, hydrationRecovery);

    // CORE WEB VITALS AS GATE EVIDENCE (Wave 4). measureRuntime was a finished
    // LCP/INP/CLS/TTFB lab that only scripts/ship-four.js ever ran, so every
    // standard build reported the runtime points as assumption. The gate
    // already holds the page open in Chromium — collectVitals reuses THIS page
    // (no second browser) and the numbers ride along with the verdict as
    // evidence. They never join problems[]: a slow page is reported, not
    // refused, and an unmeasurable page stays unverified.
    let webVitals;
    try {
      webVitals = await abortRace(collectVitals(page), bounded.signal);
    } catch (e) {
      if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
      webVitals = { status: "unavailable", reason: String(e.message || e).slice(0, 120) };
    }

    const problems = [];
    if (failedRequests.length) problems.push(`failed_requests:${failedRequests.length}`);
    if (consoleErrors.length) problems.push(`console_errors:${consoleErrors.length}`);
    if (pageErrorVerdict.fatal.length) problems.push(`page_errors:${pageErrorVerdict.fatal.length}:${pageErrorVerdict.fatal[0]}`);
    if (video.present && (video.readyState !== 4 || video.paused)) {
      problems.push(`hero_video_not_playing (readyState=${video.readyState} paused=${video.paused})`);
    }
    if (rawTokens.length) problems.push(`rendered_raw_tokens:${rawTokens.join(",")}`);
    if (!hydrationRecovery.h1Visible) problems.push("headline_not_visible");
    if (logoIdentity.status === "failed") problems.push(`logo_identity_failed:${logoIdentity.reason || "header_logo_missing"}`);
    if (themeModes.status !== "passed") problems.push(`theme_mode_contrast_failed:${themeModes.failed.map(mode => `${mode.os}_${mode.viewport}_${mode.mode}`).join(",")}`);

    return {
      status: problems.length ? "failed" : "passed",
      problems,
      failed_requests: failedRequests.slice(0, 10),
      aborted_requests: abortedRequests.slice(0, 10),
      // Evidence, never a verdict. If a customer's analytics really is
      // misconfigured this is where it shows up, without holding their site
      // hostage to our build sandbox's network.
      third_party_tag_failures: thirdPartyTagFailures.slice(0, 10),
      console_errors: consoleErrors.slice(0, 10),
      page_errors: pageErrorVerdict.fatal.slice(0, 10),
      recovered_page_errors: pageErrorVerdict.recovered.slice(0, 10),
      hydration_recovery: pageErrorVerdict.recovery,
      logo_identity: logoIdentity,
      theme_modes: themeModes,
      video,
      web_vitals: webVitals,
    };
  } catch (e) {
    if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
    return { status: "failed", problems: [`render_error: ${String(e.message || e).slice(0, 300)}`] };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** renderCheck — one rendered proof of the home page, with one retry. */
async function renderCheck(url, options = {}) {
  return withOneRetry("render", () => renderCheckOnce(url, options));
}

// ---------------------------------------------------------------------------
// renderAudit — the routes-and-prose pass, in a real browser
// ---------------------------------------------------------------------------
// renderCheck loads ONE page. That is how eight footer links pointing at one
// identical page, nav anchors aimed at ids that exist nowhere, and a sentence
// reading "and ask for  to start" all shipped with every gate green.
//
// This walks the paths the mirror itself links to and records, per path:
//   · the HTTP status the CDN actually returned,
//   · the visible innerText and a hash of it (identical hashes across distinct
//     paths = a route collision — the "8 links, 1 page" defect, measured),
//   · which of the element ids the site's own #fragments aim at are present,
//   · any broken-prose artifact in the rendered copy.
//
// "QC PASS is never proof, always render the DOM."
const crypto = require("node:crypto");
const { proseArtifacts } = require("./prose");

const MAX_PATHS = 14;

function textHash(s) {
  return crypto.createHash("sha1").update(String(s || "").replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

function normalizedContentPhrase(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function contentPhraseCount(text, phrase) {
  const wanted = normalizedContentPhrase(phrase);
  if (!wanted) return 0;
  const haystack = ` ${normalizedContentPhrase(text)} `;
  const needle = ` ${wanted} `;
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count += 1;
    // Adjacent phrases share the separator space ("x x"). Advance to that
    // boundary so both copies count; the baseline differential depends on it.
    offset += Math.max(1, needle.length - 1);
  }
  return count;
}

function targetedContentChannels(channels = {}) {
  return Object.fromEntries(Object.entries(channels).map(([channel, report]) => {
    const expected = Array.isArray(report?._expected) ? report._expected : [];
    const targetChecked = report?.target_checked === true;
    const baselineChecked = report?.baseline_checked === true;
    // A native donor can already contain words such as "Drain Cleaning" in
    // its own template, and a working bridge may replace that card 1-for-1.
    // Empty only this island channel in a second render and require the exact
    // scoped target text to change. A dead bridge has an identical target and
    // cannot borrow matching template copy.
    const targetChanged = targetChecked && baselineChecked
      && normalizedContentPhrase(report?._target_text)
        !== normalizedContentPhrase(report?._baseline_target_text);
    const rendered = targetChanged
      ? expected.filter((phrase) => (
        contentPhraseCount(report?._target_text, phrase)
          > contentPhraseCount(report?._baseline_target_text, phrase)
      )).length
      : 0;
    return [channel, {
      supplied: Number(report?.supplied) || 0,
      rendered,
      target_checked: targetChecked,
      baseline_checked: baselineChecked,
      target_changed: targetChanged,
      targets_expected: Number(report?.targets_expected) || 0,
      targets_found: Number(report?.targets_found) || 0,
      baseline_targets_found: Number(report?.baseline_targets_found) || 0,
    }];
  }));
}

function contentTargetsForPath(contentRenderTargets, p) {
  return Object.fromEntries(Object.entries(contentRenderTargets || {}).map(([channel, specs]) => [
    channel,
    (Array.isArray(specs) ? specs : [])
      .filter((spec) => spec && typeof spec === "object" && String(spec.path || "/") === p)
      .map((spec) => String(spec.selector || "").trim())
      .filter(Boolean),
  ]));
}

/**
 * renderAudit(baseUrl, { paths, hashTargets, timeoutMs })
 *   paths       — site paths to visit, "/" first. Capped at MAX_PATHS.
 *   hashTargets — [{ path, id }] fragments the site's own links promise.
 * Returns { status, pages, collisions, missing_hash_targets, prose, problems }.
 */
async function renderAuditOnce(baseUrl, {
  paths = ["/"], hashTargets = [], timeoutMs = 45000, expectInjectedOn = [], signal, deadlineAt,
  contentRenderTargets = {}, launch = launchChromium, preparePage,
} = {}) {
  const bounded = renderLimits({ timeoutMs, signal, deadlineAt });
  let browser;
  try {
    browser = await launchWithAbort(launch, bounded.signal);
  } catch (e) {
    if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
    return { status: "unavailable", reason: `chromium_launch_failed: ${String(e.message || e).slice(0, 400)}` };
  }
  const base = String(baseUrl).replace(/\/+$/, "");
  const wanted = [...new Set(["/"].concat(paths))].slice(0, MAX_PATHS);
  const byId = new Map();
  for (const t of hashTargets) {
    if (!t || !t.id) continue;
    const list = byId.get(t.path) || [];
    list.push(t.id);
    byId.set(t.path, list);
  }

  const pages = [];
  const prose = [];
  try {
    const page = await browser.newPage();
    if (typeof preparePage === "function") {
      await abortRace(Promise.resolve().then(() => preparePage(page)), bounded.signal);
    }
    const baselineChannels = Object.entries(contentRenderTargets || {})
      .filter(([, specs]) => Array.isArray(specs) && specs.some((spec) => spec && typeof spec === "object" && String(spec.selector || "").trim()))
      .map(([channel]) => channel);
    const baselineIdentity = donorBaselineCacheIdentity(contentRenderTargets);
    const contentTargetsByPath = new Map();
    const cachedBaselineByPath = new Map();
    let baselineMiss = false;
    for (const p of wanted) {
      const targets = contentTargetsForPath(contentRenderTargets, p);
      contentTargetsByPath.set(p, targets);
      const hasTargets = Object.values(targets).some((selectors) => selectors.length > 0);
      if (!hasTargets) continue;
      const cached = cachedBaselineTargets(baselineIdentity, p, targets);
      if (cached) cachedBaselineByPath.set(p, cached);
      else baselineMiss = true;
    }
    const baselinePage = baselineChannels.length && baselineMiss ? await browser.newPage() : null;
    const baselinePageErrors = [];
    if (baselinePage) {
      baselinePage.on("pageerror", (err) => {
        baselinePageErrors.push(String((err && err.message) || err).slice(0, 200));
      });
      // Install before any page script. The normal page receives the untouched
      // island; this page receives the same build with only the audited native
      // channels emptied. No second deploy and no template guesswork.
      await abortRace(baselinePage.addInitScript((channels) => {
        let current;
        Object.defineProperty(window, "__WSS_CONTENT__", {
          configurable: true,
          get() { return current; },
          set(value) {
            const next = value && typeof value === "object" ? { ...value } : {};
            for (const channel of channels) {
              if (channel === "about") next[channel] = "";
              else if (channel === "hours") next[channel] = null;
              else next[channel] = [];
            }
            current = next;
          },
        });
      }, baselineChannels), bounded.signal);
      if (typeof preparePage === "function") {
        await abortRace(Promise.resolve().then(() => preparePage(baselinePage)), bounded.signal);
      }
    }
    for (const p of wanted) {
      let httpStatus = 0;
      try {
        const res = await abortRace(
          page.goto(base + p, { waitUntil: "networkidle", timeout: bounded.timeoutMs }),
          bounded.signal,
        );
        httpStatus = res ? res.status() : 0;
      } catch (e) {
        if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
        pages.push({ path: p, status: 0, error: String(e.message || e).slice(0, 140) });
        continue;
      }
      const contentTargets = contentTargetsByPath.get(p) || contentTargetsForPath(contentRenderTargets, p);
      let baselineTargets = cachedBaselineByPath.get(p) || {};
      const hasContentTargets = Object.values(contentTargets).some((selectors) => selectors.length > 0);
      if (!cachedBaselineByPath.has(p) && baselinePage && hasContentTargets) {
        try {
          baselinePageErrors.length = 0;
          const res = await abortRace(
            baselinePage.goto(base + p, { waitUntil: "networkidle", timeout: bounded.timeoutMs }),
            bounded.signal,
          );
          if (res && res.status() === 200 && baselinePageErrors.length === 0) {
            baselineTargets = await abortRace(baselinePage.evaluate((channelTargets) =>
              Object.fromEntries(Object.entries(channelTargets).map(([channel, selectors]) => {
                const scopes = [];
                for (const selector of Array.isArray(selectors) ? selectors : []) {
                  try {
                    for (const node of document.querySelectorAll(selector)) {
                      if (node.getBoundingClientRect().height > 0 && !scopes.includes(node)) scopes.push(node);
                    }
                  } catch { /* invalid selectors fail closed in the normal report */ }
                }
                return [channel, {
                  _baseline_target_text: scopes.map((node) => node.innerText || "").join("\n"),
                  baseline_checked: true,
                  baseline_targets_found: scopes.length,
                }];
              })), contentTargets), bounded.signal);
            storeBaselineTargets(baselineIdentity, p, contentTargets, baselineTargets);
          }
        } catch (e) {
          if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
          baselineTargets = {};
        }
      }
      const info = await abortRace(page.evaluate((input) => {
        const ids = Array.isArray(input?.ids) ? input.ids : [];
        const channelTargets = input?.contentTargets && typeof input.contentTargets === "object"
          ? input.contentTargets : {};
        const body = document.body;
        const renderedContentChannels = (() => {
          const island = window.__WSS_CONTENT__ || {};
          const values = {
            services: (Array.isArray(island.services) ? island.services : [])
              .map((item) => typeof item === "string" ? item : item && (item.name || item.title)),
            faqs: (Array.isArray(island.faqs) ? island.faqs : [])
              .map((item) => item && (item.q || item.question)),
            areas: (Array.isArray(island.areas) ? island.areas : [])
              .map((item) => typeof item === "string" ? item : item && item.name),
            reviews: (Array.isArray(island.reviews) ? island.reviews : [])
              .map((item) => typeof item === "string" ? item : item && (item.text || item.body || item.quote)),
            hours: (Array.isArray(island.hours) ? island.hours : [])
              .map((item) => typeof item === "string" ? item : item && [item.day, item.text || item.hours || item.value].filter(Boolean).join(" ")),
            about: [typeof island.about === "string" ? island.about : ""],
          };
          return Object.fromEntries(Object.entries(values).map(([channel, rows]) => {
            const expected = rows.map((value) => String(value || "").toLowerCase()
              .replace(/[^a-z0-9]+/g, " ").trim())
              .filter((value) => value.length >= 3);
            const selectors = Array.isArray(channelTargets[channel]) ? channelTargets[channel] : [];
            const scopes = [];
            for (const selector of selectors) {
              try {
                for (const node of document.querySelectorAll(selector)) {
                  if (node.getBoundingClientRect().height > 0 && !scopes.includes(node)) scopes.push(node);
                }
              } catch { /* invalid manifest selector fails closed below */ }
            }
            return [channel, {
              supplied: expected.length,
              _expected: expected,
              _target_text: scopes.map((node) => node.innerText || "").join("\n"),
              target_checked: selectors.length > 0 && scopes.length > 0,
              targets_expected: selectors.length,
              targets_found: scopes.length,
            }];
          }));
        })();
        // PROSE SCAN TEXT vs PAGE TEXT are not the same string. The prose rules
        // hunt for holes WE left when a token collapsed ("Ask for · ", "with
        // to…"). A Google review is verbatim third-party prose we neither wrote
        // nor may edit, and real customers write "great to work with and
        // totally took care of us" — which trips the preposition-pair rule and
        // failed an otherwise clean mirror. So verbatim blocks are excluded
        // from the PROSE text only; the page text used for route-collision
        // hashing still contains every word on the page.
        let proseText = "";
        if (body) {
          const clone = body.cloneNode(true);
          for (const n of clone.querySelectorAll("[data-wss-verbatim]")) n.remove();
          // DONOR-AGNOSTIC VERBATIM: only some donors stamp the attribute on
          // their review components. The page's own content island knows every
          // third-party review it carries, so any element whose text contains
          // one is removed from the PROSE clone too — a customer writing
          // "so good to work with and really were considerate" is not our
          // broken copy (measured convicting live builds, 2026-08-20). Page
          // text used for collision hashing is untouched, exactly like the
          // attribute path above.
          try {
            const wss = window.__WSS_CONTENT__ || {};
            const texts = (Array.isArray(wss.reviews) ? wss.reviews : [])
              .map((r) => String((r && (r.text || r.body || r.quote)) || (typeof r === "string" ? r : "")))
              .filter((t) => t.length >= 40)
              .map((t) => t.slice(0, 80).replace(/\s+/g, " ").trim());
            if (texts.length) {
              for (const el of clone.querySelectorAll("p,blockquote,li,figcaption,q,span,div")) {
                if (el.children.length > 2) continue;
                const own = (el.textContent || "").replace(/\s+/g, " ");
                if (texts.some((t) => own.includes(t))) el.remove();
              }
            }
          } catch (verbatimErr) { /* island absent = nothing to exclude */ }
          // innerText needs layout, which a detached clone does not have, so
          // the clone is measured inside a hidden host that is removed again.
          const host = document.createElement("div");
          host.style.cssText = "position:absolute;left:-99999px;top:0;width:1200px";
          host.appendChild(clone);
          document.body.appendChild(host);
          proseText = clone.innerText || "";
          host.remove();
        }
        return {
          text: body ? body.innerText : "",
          prose_text: proseText,
          verbatim_blocks: body ? body.querySelectorAll("[data-wss-verbatim]").length : 0,
          // Injected sections COUNTED IN THE RENDERED DOM, and only the ones a
          // visitor can actually see. checks.content counts them in the FILES,
          // which is how a React donor that discarded the server markup on
          // hydration still reported "injected: 3 sections" while the page
          // showed none — and how a static donor shipped all three inside a
          // display:none wrapper and still reported three.
          injected_sections: body
            ? [...body.querySelectorAll("section.wss-c")]
              .filter((n) => n.getBoundingClientRect().height > 0).length
            : 0,
          injected_sections_in_markup: body ? body.querySelectorAll("section.wss-c").length : 0,
          // Native donors read window.__WSS_CONTENT__ themselves instead of
          // receiving appended section.wss-c markup. Only the exact visible
          // channel target declared by the donor may prove those phrases;
          // quote selects, marquees and footer echoes do not count.
          content_channels: renderedContentChannels,
          title: document.title || "",
          // THE FIRST HEADING, AS A VISITOR RECEIVES IT. Read from the DOM,
          // not from the bytes: these are React SPAs, so the h1 does not exist
          // until hydration and "fetch the HTML and look for <h1>" proves
          // nothing. This is the evidence the sameness gate judges — 32 HVAC
          // mirrors published one identical h1 and no gate had ever read one.
          h1: (() => {
            const el = document.querySelector("h1");
            return el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim() : "";
          })(),
          h1_count: document.querySelectorAll("h1").length,
          found: (ids || []).filter((id) => Boolean(document.getElementById(id))),
        };
      }, { ids: byId.get(p) || [], contentTargets }), bounded.signal);
      for (const [channel, report] of Object.entries(info.content_channels || {})) {
        Object.assign(report, baselineTargets[channel] || {});
      }
      info.content_channels = targetedContentChannels(info.content_channels);
      const artifacts = proseArtifacts(info.prose_text || info.text);
      if (artifacts.length) prose.push({ path: p, artifacts: artifacts.slice(0, 6) });
      // ENTITY RESIDUE. Read from innerText — the characters a visitor's eye
      // receives — not from the markup, where "&amp;" is correct and expected.
      // Flint Plumbing rendered "Hydrostatic Tests &#038; Tunneling Repair" on
      // a live card while every gate in the build reported passed, because no
      // gate had ever looked at the rendered words for entity syntax. It does
      // now, and it fails the build.
      const entityText = [info.title, info.text].filter(Boolean).join(" ");
      const residue = residualEntities(entityText);
      pages.push({
        path: p,
        status: httpStatus,
        title: info.title.slice(0, 120),
        h1: String(info.h1 || "").slice(0, 240),
        h1_count: info.h1_count,
        chars: info.text.length,
        entity_residue: residue,
        injected_sections: info.injected_sections,
        injected_sections_in_markup: info.injected_sections_in_markup,
        content_channels: info.content_channels,
        text_hash: textHash(info.text),
        hash_targets_found: info.found,
        hash_targets_expected: (byId.get(p) || []).length,
      });
    }
  } catch (e) {
    await browser.close().catch(() => {});
    if ((bounded.signal && bounded.signal.aborted) || (e && e.name === "AbortError")) throw e;
    return { status: "failed", problems: [`render_audit_error: ${String(e.message || e).slice(0, 300)}`] };
  }
  await browser.close().catch(() => {});

  // Route collisions: two DIFFERENT paths rendering the identical page.
  const groups = new Map();
  for (const pg of pages) {
    if (!pg.text_hash || pg.chars < 40) continue;
    const list = groups.get(pg.text_hash) || [];
    list.push(pg.path);
    groups.set(pg.text_hash, list);
  }
  const collisions = [...groups.values()].filter((l) => l.length > 1).map((l) => l.sort());

  const missingHash = [];
  for (const [p, ids] of byId) {
    const pg = pages.find((x) => x.path === p);
    const found = new Set((pg && pg.hash_targets_found) || []);
    for (const id of ids) if (!found.has(id)) missingHash.push({ path: p, id });
  }

  const emptyBodies = pages.filter((p) => p.status === 200 && (p.chars || 0) < 40).map((p) => p.path);
  const badStatus = pages.filter((p) => p.status !== 200).map((p) => ({ path: p.path, status: p.status }));

  const problems = [];
  if (badStatus.length) problems.push(`non_200_paths:${badStatus.map((b) => `${b.path}=${b.status}`).join(",")}`);
  if (emptyBodies.length) problems.push(`empty_rendered_body:${emptyBodies.join(",")}`);
  if (collisions.length) problems.push(`route_collisions:${collisions.map((c) => c.join("=")).join(" | ")}`);
  if (missingHash.length) problems.push(`missing_hash_targets:${missingHash.map((m) => m.path + "#" + m.id).join(",")}`);
  // PRINT WHAT THE PAGE SAID, not just which rule fired. The rule name is the
  // pattern's label — `dangling_word:"with to…"` — and it names a word pair the
  // page does not necessarily contain. Mills Fence's refusal read exactly that
  // while the offending line was a customer review saying "…so awesome to work
  // with and we couldn't be happier", which is ordinary English. An operator
  // reading the label alone cannot tell a real hole from a false positive, and
  // the excerpt was already captured one function away.
  if (prose.length) {
    problems.push(`broken_prose:${prose.map((x) => {
      const first = x.artifacts[0] || {};
      return `${x.path}:${first.rule}${first.excerpt ? ` :: "${String(first.excerpt).slice(0, 120)}"` : ""}`;
    }).join(",")}`);
  }

  const entityPages = pages.filter((p) => (p.entity_residue || []).length);
  if (entityPages.length) {
    problems.push(`entity_residue_in_rendered_text:${entityPages
      .map((p) => `${p.path}=${p.entity_residue.join(" ")}`)
      .join(" | ")}`);
  }

  // CONTENT THAT SHIPPED IN THE FILE BUT NOT IN THE PAGE. Named separately from
  // an empty body: the page is full of donor chrome and reads fine, and only
  // the client's own services/reviews/FAQ are missing.
  const contentLost = expectInjectedOn
    .map((p) => pages.find((x) => x.path === p))
    .filter((pg) => pg && pg.status === 200 && !pg.injected_sections)
    .map((pg) => pg.path);
  if (contentLost.length) {
    const hidden = contentLost.filter((p) => {
      const pg = pages.find((x) => x.path === p);
      return pg && pg.injected_sections_in_markup > 0;
    });
    problems.push(hidden.length
      ? `injected_content_present_but_not_visible:${hidden.join(",")}`
      : `injected_content_not_in_rendered_dom:${contentLost.join(",")}`);
  }

  return {
    status: problems.length ? "failed" : "passed",
    problems,
    pages,
    collisions,
    missing_hash_targets: missingHash.slice(0, 20),
    prose: prose.slice(0, 8),
    paths_rendered: pages.length,
  };
}

/** renderAudit — the routes-and-prose walk, with one retry. */
async function renderAudit(baseUrl, options = {}) {
  return withOneRetry("route_render", () => renderAuditOnce(baseUrl, options));
}

module.exports = {
  renderCheck,
  renderAudit,
  textHash,
  targetedContentChannels,
  // exported so the retry policy itself is testable, and so a caller can ask
  // "could a second look have changed this?" without re-deriving the rules.
  worthRetrying,
  STATIC_PROBLEM,
  renderCheckOnce,
  renderAuditOnce,
  classifyPageErrors,
  measureThemeHeadlineContrast,
  // exported so the exemption can be tested on its own — it is the difference
  // between "this customer's page is broken" and "our build sandbox cannot
  // reach Google", and those must never be confused again.
  isTagVendorUrl,
  TAG_VENDOR_HOSTS,
};
