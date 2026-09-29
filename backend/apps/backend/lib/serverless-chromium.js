"use strict";
// ONE browser launcher for every rendered proof surface.
//
// Production default: when FIRECRAWL_API_KEY is present, use Firecrawl's
// remote Browser/CDP service so a 50-site run does not inflate/hold multiple
// ~150MB Chromium processes inside one Vercel function. Local Chromium remains
// the bounded fallback and the normal developer path.

const DEFAULT_RENDER_CONCURRENCY = 2;
const MAX_RENDER_CONCURRENCY = 4;
// MEASURED 2026-08-19: ten was too many and it cost every build.
//
// The queue worker and the rescue cron BOTH run passes, and each claimed up to
// ten remote sessions, so ~20 browsers could be live at once. Production paid
// for it at the only place it matters — inside the render gate:
//   page.goto: net::ERR_INSUFFICIENT_RESOURCES
//   first attempt failed: Target page, context or browser has been closed
// The mirror deployed fine, then could not be RENDERED, so route_render saw
// status 0 on every path, the build was "not revealable", the phase burned its
// whole ~270s budget, deferred, retried, and finally exhausted. No site was
// ever produced. Browser starvation, not donor or prospect trouble.
//
// A smaller pool is strictly better than a starved one: a build that finishes
// slowly beats a wave of builds that all fail. 20 stays the operator-tunable
// ceiling (GHOST_AGENCY_RENDER_CONCURRENCY) for when this is proven healthy.
const DEFAULT_REMOTE_RENDER_CONCURRENCY = 3;
const MAX_REMOTE_RENDER_CONCURRENCY = 20;
const RENDER_CONCURRENCY_ENV = "GHOST_AGENCY_RENDER_CONCURRENCY";
const REMOTE_BROWSER_ENV = "GHOST_AGENCY_REMOTE_BROWSER";
const FIRECRAWL_BROWSER_ENDPOINT = "https://api.firecrawl.dev/v2/browser";

// The dead-man release must not fire while the render that holds the permit is
// still legitimately running: releasing early hands the slot to another caller
// and over-subscribes the pool — the same starvation this file just fixed.
// 295s sits just under the 300s function ceiling, so the permit outlives any
// render the platform can still be executing, and a truly leaked permit is
// still reclaimed before the function dies.
const MAX_PERMIT_HOLD_MS = 295_000;
const PERMIT_WAIT_TIMEOUT_MS = 300_000;
const REMOTE_REQUEST_TIMEOUT_MS = 15_000;

function explicitFalse(value) {
  return ["0", "false", "off", "local", "disabled"].includes(String(value || "").trim().toLowerCase());
}

function remoteBrowserEnabled(env = process.env) {
  if (explicitFalse(env[REMOTE_BROWSER_ENV])) return false;
  return Boolean(String(env.FIRECRAWL_API_KEY || "").trim());
}

function concurrencyValue(value, fallback, maximum) {
  const n = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, maximum);
}

function localRenderConcurrency(value = process.env[RENDER_CONCURRENCY_ENV]) {
  return concurrencyValue(value, DEFAULT_RENDER_CONCURRENCY, MAX_RENDER_CONCURRENCY);
}

function renderConcurrency(value = process.env[RENDER_CONCURRENCY_ENV], env = process.env) {
  return remoteBrowserEnabled(env)
    ? concurrencyValue(value, DEFAULT_REMOTE_RENDER_CONCURRENCY, MAX_REMOTE_RENDER_CONCURRENCY)
    : localRenderConcurrency(value);
}

function createSemaphore(limitFn) {
  let held = 0;
  const waiters = [];

  const pump = () => {
    while (waiters.length && held < limitFn()) {
      const next = waiters.shift();
      if (next.settled) continue;
      next.settled = true;
      held += 1;
      clearTimeout(next.timer);
      next.resolve(makeRelease());
    }
  };

  const makeRelease = () => {
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      held -= 1;
      clearTimeout(release._timer);
      pump();
    };
    release._timer = setTimeout(release, MAX_PERMIT_HOLD_MS);
    if (typeof release._timer.unref === "function") release._timer.unref();
    return release;
  };

  return {
    async acquire() {
      if (held < limitFn()) {
        held += 1;
        return makeRelease();
      }
      return new Promise((resolve, reject) => {
        const waiter = { settled: false, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          if (waiter.settled) return;
          waiter.settled = true;
          reject(new Error(`render_permit_timeout after ${PERMIT_WAIT_TIMEOUT_MS}ms`));
        }, PERMIT_WAIT_TIMEOUT_MS);
        if (typeof waiter.timer.unref === "function") waiter.timer.unref();
        waiters.push(waiter);
      });
    },
    _debug: () => ({ held, waiting: waiters.length, limit: limitFn() }),
  };
}

const localBrowserPermits = createSemaphore(localRenderConcurrency);
const remoteBrowserPermits = createSemaphore(renderConcurrency);

// ---------------------------------------------------------------------------
// LOCAL SERVERLESS CHROMIUM — correctness fallback and developer path.
// ---------------------------------------------------------------------------
let executablePathOnce = null;

async function serverlessExecutablePath(spart) {
  if (!executablePathOnce) {
    executablePathOnce = Promise.resolve()
      .then(() => spart.executablePath())
      .catch((e) => { executablePathOnce = null; throw e; });
  }
  return executablePathOnce;
}

async function rawLocalLaunch() {
  let localErr;
  // LOCAL-FIRST TLS: the local stack terminates *.wss-ai.com on the compose
  // gateway with the locally-generated CA, which Playwright's bundled Chromium
  // cannot be taught to trust via the system store (NSS). Gated behind an
  // explicit env flag set only by the local runtime — production keeps strict
  // validation, and capture identity remains enforced by the response
  // identity markers + host allowlist, not by TLS PKI.
  const localGatewayTls = String(process.env.GHOST_AGENCY_LOCAL_CHROMIUM_LOCAL_TLS || "").trim() === "1";
  const launchArgs = localGatewayTls ? ["--ignore-certificate-errors"] : undefined;
  try {
    const { chromium } = require("playwright");
    return await chromium.launch({ headless: true, ...(launchArgs ? { args: launchArgs } : {}) });
  } catch (e) {
    localErr = e;
  }
  try {
    const spart = require("@sparticuz/chromium");
    const { chromium } = require("playwright-core");
    const args = spart.args.filter((a) => a !== "--single-process");
    args.push("--autoplay-policy=no-user-gesture-required");
    return await chromium.launch({
      args,
      executablePath: await serverlessExecutablePath(spart),
      headless: true,
    });
  } catch (e) {
    throw new Error(
      `local: ${String((localErr && localErr.message) || localErr).slice(0, 120)}` +
      ` | serverless: ${String(e.message || e).slice(0, 120)}`,
    );
  }
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve(fetchImpl(url, { ...options, signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

async function closeFirecrawlSession(sessionId, apiKey, fetchImpl = global.fetch) {
  if (!sessionId || !apiKey || typeof fetchImpl !== "function") return false;
  try {
    const response = await fetchWithTimeout(fetchImpl, `${FIRECRAWL_BROWSER_ENDPOINT}/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    }, 8_000);
    return Boolean(response && response.ok);
  } catch {
    return false;
  }
}

async function createFirecrawlBrowser({
  apiKey = String(process.env.FIRECRAWL_API_KEY || "").trim(),
  fetchImpl = global.fetch,
  connectOverCDP,
} = {}) {
  if (!apiKey) throw new Error("firecrawl_browser_key_missing");
  if (typeof fetchImpl !== "function") throw new Error("firecrawl_browser_fetch_missing");

  let response;
  try {
    response = await fetchWithTimeout(fetchImpl, FIRECRAWL_BROWSER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // The session must outlive the phase that borrowed it. A mirror build can
      // legitimately run to the ~270s mirror budget, and a 240s session TTL
      // expired UNDER an in-flight render — the observed "Target page, context
      // or browser has been closed". Give the session room past the worker
      // deadline (282s) so a slow-but-healthy build still gets its render;
      // activityTtl still reaps a genuinely idle session.
      body: JSON.stringify({ ttl: 600, activityTtl: 300, streamWebView: false }),
    });
  } catch (error) {
    throw new Error(`firecrawl_browser_create_failed:${String(error.message || error).slice(0, 180)}`);
  }

  if (!response || !response.ok) {
    throw new Error(`firecrawl_browser_create_http_${response ? response.status : 0}`);
  }
  const payload = await response.json().catch(() => ({}));
  const sessionId = String(payload.id || "").trim();
  const cdpUrl = String(payload.cdpUrl || "").trim();
  if (!sessionId || !/^wss?:\/\//i.test(cdpUrl)) {
    if (sessionId) await closeFirecrawlSession(sessionId, apiKey, fetchImpl);
    throw new Error("firecrawl_browser_create_invalid_response");
  }

  try {
    const connect = connectOverCDP || ((url) => {
      const { chromium } = require("playwright-core");
      return chromium.connectOverCDP(url, { timeout: REMOTE_REQUEST_TIMEOUT_MS });
    });
    const browser = await connect(cdpUrl);
    return {
      browser,
      sessionId,
      async destroy() {
        try {
          if (browser && typeof browser.close === "function") await browser.close();
        } finally {
          await closeFirecrawlSession(sessionId, apiKey, fetchImpl);
        }
      },
    };
  } catch (error) {
    await closeFirecrawlSession(sessionId, apiKey, fetchImpl);
    throw new Error(`firecrawl_browser_connect_failed:${String(error.message || error).slice(0, 180)}`);
  }
}

function logLaunch({ provider, permitWaitMs, launchMs, attempts, fallbackReason = "" }) {
  if (!(process.env.VERCEL || process.env.GHOST_AGENCY_PHASE_LOGS === "true")) return;
  console.log(JSON.stringify({
    event: "render_browser_launch",
    provider,
    permit_wait_ms: permitWaitMs,
    launch_ms: launchMs,
    attempts,
    concurrency: provider === "firecrawl" ? renderConcurrency() : localRenderConcurrency(),
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  }));
}

function wrapBrowserClose(browser, release, extraCleanup = async () => {}) {
  let finalized = false;
  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    try { await extraCleanup(); } finally { release(); }
  };
  const realClose = browser.close.bind(browser);
  browser.close = async (...args) => {
    try {
      return await realClose(...args);
    } finally {
      await finalize();
    }
  };
  if (typeof browser.on === "function") {
    browser.on("disconnected", () => { finalize().catch(() => {}); });
  }
  return browser;
}

async function launchLocal({ retries = 1, fallbackReason = "" } = {}) {
  const requestedAt = Date.now();
  const release = await localBrowserPermits.acquire();
  const permitWaitMs = Math.max(0, Date.now() - requestedAt);
  const launchStartedAt = Date.now();
  const attempts = [];
  let browser;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      browser = await rawLocalLaunch();
      break;
    } catch (error) {
      attempts.push(String(error.message || error).slice(0, 200));
      if (attempt >= retries) {
        release();
        throw new Error(`chromium_launch_failed after ${attempts.length} attempt(s): ${attempts.join(" || ")}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  logLaunch({
    provider: "local",
    permitWaitMs,
    launchMs: Math.max(0, Date.now() - launchStartedAt),
    attempts: attempts.length + 1,
    fallbackReason,
  });
  return wrapBrowserClose(browser, release);
}

/**
 * launchChromium — Firecrawl remote browser first in production when configured;
 * bounded local Chromium otherwise. Call sites keep the exact Browser API they
 * already use, so render truth checks do not weaken or fork.
 */
async function launchChromium({ retries = 1 } = {}) {
  if (!remoteBrowserEnabled()) return launchLocal({ retries });

  const requestedAt = Date.now();
  const release = await remoteBrowserPermits.acquire();
  const permitWaitMs = Math.max(0, Date.now() - requestedAt);
  const launchStartedAt = Date.now();
  const apiKey = String(process.env.FIRECRAWL_API_KEY || "").trim();
  const attempts = [];
  let remote;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      remote = await createFirecrawlBrowser({ apiKey });
      break;
    } catch (error) {
      attempts.push(String(error.message || error).slice(0, 200));
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  if (!remote) {
    release();
    const reason = attempts.join(" || ") || "firecrawl_browser_unavailable";
    if (process.env.VERCEL || process.env.GHOST_AGENCY_PHASE_LOGS === "true") {
      console.warn(JSON.stringify({ event: "render_browser_remote_fallback", reason }));
    }
    return launchLocal({ retries, fallbackReason: reason.slice(0, 220) });
  }

  logLaunch({
    provider: "firecrawl",
    permitWaitMs,
    launchMs: Math.max(0, Date.now() - launchStartedAt),
    attempts: attempts.length + 1,
  });

  // createFirecrawlBrowser.destroy() calls browser.close itself, so the wrapper
  // cleanup only destroys the Firecrawl session after the caller's close.
  const browser = remote.browser;
  return wrapBrowserClose(browser, release, async () => {
    await closeFirecrawlSession(remote.sessionId, apiKey);
  });
}

module.exports = {
  launchChromium,
  renderConcurrency,
  localRenderConcurrency,
  remoteBrowserEnabled,
  createFirecrawlBrowser,
  closeFirecrawlSession,
  RENDER_CONCURRENCY_ENV,
  REMOTE_BROWSER_ENV,
  DEFAULT_RENDER_CONCURRENCY,
  MAX_RENDER_CONCURRENCY,
  DEFAULT_REMOTE_RENDER_CONCURRENCY,
  MAX_REMOTE_RENDER_CONCURRENCY,
  createSemaphore,
  serverlessExecutablePath,
  _resetExecutablePathOnce: () => { executablePathOnce = null; },
  _permits: localBrowserPermits,
  _remotePermits: remoteBrowserPermits,
};