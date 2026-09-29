const SERVERLESS_FLAGS = ["VERCEL", "AWS_LAMBDA_FUNCTION_NAME"];
export const DEFAULT_CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v149.0.0/chromium-v149.0.0-pack.x64.tar";

let executablePathPromise = null;
let executablePathSource = null;

export function isServerlessChromiumEnvironment(env = process.env) {
  return env.SITEFORGE_SERVERLESS === "1" || SERVERLESS_FLAGS.some((key) => Boolean(env[key]));
}

export function resolveChromiumPackUrl(env = process.env) {
  const value = String(env.SITEFORGE_CHROMIUM_PACK_URL || env.CHROMIUM_PACK_URL || DEFAULT_CHROMIUM_PACK_URL).trim();
  let url;
  try { url = new URL(value); }
  catch { throw new Error("SITEFORGE_CHROMIUM_PACK_URL must be a valid HTTPS URL"); }
  if (url.protocol !== "https:") throw new Error("SITEFORGE_CHROMIUM_PACK_URL must use HTTPS");
  return url.href;
}

export function mergeChromiumArgs(required = [], extra = []) {
  return [...new Set([...required, ...extra].filter(Boolean))];
}

async function serverlessExecutablePath(chromium, packUrl) {
  if (!executablePathPromise || executablePathSource !== packUrl) {
    executablePathSource = packUrl;
    executablePathPromise = chromium.executablePath(packUrl);
  }
  return executablePathPromise;
}

export async function launchChromium(options = {}) {
  if (!isServerlessChromiumEnvironment()) {
    const playwright = await import("playwright");
    // Optional explicit binary for environments with a preinstalled Chromium
    // whose revision differs from the installed playwright package.
    const explicitExecutablePath = String(process.env.SITEFORGE_CHROMIUM_EXECUTABLE_PATH || "").trim();
    return playwright.chromium.launch({
      headless: true,
      ...(explicitExecutablePath ? { executablePath: explicitExecutablePath } : {}),
      ...options,
    });
  }

  const packUrl = resolveChromiumPackUrl();
  const [coreModule, chromiumModule] = await Promise.all([
    import("playwright-core"),
    import("@sparticuz/chromium-min"),
  ]);
  const chromium = chromiumModule.default ?? chromiumModule;
  const playwrightChromium = coreModule.chromium ?? coreModule.default?.chromium;
  if (!playwrightChromium || typeof chromium.executablePath !== "function") {
    throw new Error("Serverless Chromium dependencies did not expose the expected launch API");
  }

  const executablePath = await serverlessExecutablePath(chromium, packUrl);
  return playwrightChromium.launch({
    ...options,
    args: mergeChromiumArgs(chromium.args, options.args),
    executablePath,
    headless: true,
  });
}

export function isChromiumLifecycleError(error) {
  return /(?:target page|target closed|browser(?:\.\w+)? has been closed|browser closed|browser\.newpage)/i
    .test(String(error?.message || error || ""));
}

export function isChromiumTimeoutError(error) {
  if (String(error?.name || "") === "TimeoutError") return true;
  return /(?:page|frame|locator|elementhandle)\.\w+:\s*Timeout \d+ms exceeded/i
    .test(String(error?.message || error || ""));
}

export function isChromiumScreenshotProtocolError(error) {
  return /Page\.captureScreenshot[\s\S]*(?:unable to capture screenshot|timed out|target closed|session closed)/i
    .test(String(error?.message || error || ""));
}

export function classifyChromiumCaptureError(error) {
  if (!isChromiumLifecycleError(error) && !isChromiumTimeoutError(error)) return error;
  error.code ||= "visual_capture_failed";
  error.retryable = true;
  return error;
}

export function screenshotCaptureBudgetPlan(fullPage = false) {
  return fullPage
    ? { total: 45_000, playwright: 18_000, cdpLayout: 3_000, cdpScreenshot: 12_000 }
    : { total: 30_000, playwright: 10_000, cdpLayout: 3_000, cdpScreenshot: 8_000 };
}

export async function openChromiumPageWithRecovery(browser, pageOptions = {}, options = {}) {
  const signal = options.signal;
  const launchBrowser = options.launchBrowser || launchChromium;
  try {
    return { browser, page: await browser.newPage(pageOptions), recovered: false };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    if (!isChromiumLifecycleError(error)) throw error;
  }

  await browser?.close().catch(() => {});
  let replacement;
  try {
    replacement = await launchBrowser();
    if (signal?.aborted) {
      await replacement.close().catch(() => {});
      throw signal.reason || new Error("Screenshot capture was aborted.");
    }
    return {
      browser: replacement,
      page: await replacement.newPage(pageOptions),
      recovered: true,
    };
  } catch (error) {
    await replacement?.close().catch(() => {});
    if (signal?.aborted) throw signal.reason || error;
    throw classifyChromiumCaptureError(error);
  }
}

// Screenshot fallbacks that all call Page.captureScreenshot are not independent:
// one wedged compositor makes Playwright, raw CDP, and locator screenshots fail
// together. Recover one capture on a new Chromium process and a newly prepared
// page. The caller owns the returned healthy browser/page and still fails closed
// when the replacement cannot produce the artifact.
export async function captureWithFreshChromiumRecovery(options = {}) {
  const {
    browser,
    page,
    pageOptions = {},
    signal,
    capture,
    preparePage,
    launchBrowser = launchChromium,
    allowRecovery = true,
  } = options;
  if (typeof capture !== "function") throw new TypeError("capture must be a function");
  if (typeof preparePage !== "function") throw new TypeError("preparePage must be a function");

  try {
    await capture(page);
    return { browser, page, recovered: false };
  } catch (error) {
    if (signal?.aborted) throw signal.reason || error;
    const recoverable = isChromiumScreenshotProtocolError(error)
      || isChromiumLifecycleError(error)
      || isChromiumTimeoutError(error);
    if (!allowRecovery || !recoverable) throw error;

    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    let replacementBrowser;
    let replacementPage;
    let abortReplacement;
    try {
      replacementBrowser = await launchBrowser();
      abortReplacement = () => {
        void replacementBrowser?.close().catch(() => {});
      };
      signal?.addEventListener("abort", abortReplacement, { once: true });
      if (signal?.aborted) throw signal.reason || new Error("Screenshot capture was aborted.");
      replacementPage = await replacementBrowser.newPage(pageOptions);
      await preparePage(replacementPage);
      if (signal?.aborted) throw signal.reason || new Error("Screenshot capture was aborted.");
      await capture(replacementPage);
      signal?.removeEventListener("abort", abortReplacement);
      return {
        browser: replacementBrowser,
        page: replacementPage,
        recovered: true,
        initialError: error,
      };
    } catch (recoveryError) {
      signal?.removeEventListener("abort", abortReplacement);
      await replacementPage?.close().catch(() => {});
      await replacementBrowser?.close().catch(() => {});
      if (signal?.aborted) throw signal.reason || recoveryError;
      const combined = new Error(
        `${String(error?.message || error).split("\n")[0]}; fresh Chromium recovery failed: ${String(recoveryError?.message || recoveryError).split("\n")[0]}`,
        { cause: recoveryError },
      );
      combined.code = "visual_capture_failed";
      combined.retryable = true;
      throw combined;
    }
  }
}

export async function navigateChromiumPageForCapture(page, url, options = {}) {
  const phase = String(options.phase || "capture");
  const timeoutMs = Number(options.timeoutMs || 45_000);
  const operationTimeoutMs = Math.max(500, Number(options.operationTimeoutMs || 2_000));
  const bounded = (promise, label) => new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error(`${label} timed out after ${operationTimeoutMs}ms`), { name: "TimeoutError" })),
      operationTimeoutMs,
    );
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
  const readiness = async () => bounded(
    page.evaluate(() => {
      const heroRoot = document.querySelector("[data-hero-anatomy],[data-hero-architecture],.hero");
      const heroCopy = heroRoot?.querySelector("h1,[data-hero-layer='copy']");
      const bounds = heroRoot?.getBoundingClientRect();
      return {
        body: Boolean(document.body),
        hero: Boolean(
          heroRoot
          && heroCopy
          && String(heroCopy.textContent || "").trim().length >= 3
          && bounds
          && bounds.width >= 200
          && bounds.height >= 120
        ),
      };
    }),
    `${phase} DOM readiness`,
  );
  let navigationTimedOut = false;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (error) {
    if (!isChromiumTimeoutError(error)) throw error;
    navigationTimedOut = true;
    let session;
    try {
      session = await page.context().newCDPSession(page);
      await bounded(session.send("Page.stopLoading"), `${phase} Page.stopLoading`);
    } catch {
      // Readiness below is the authority. A failed stop command cannot turn a
      // partial document into acceptable screenshot proof.
    } finally {
      await session?.detach().catch(() => {});
    }
  }

  let ready;
  try {
    ready = await readiness();
  } catch (error) {
    if (navigationTimedOut) {
      const timeout = new Error(`page.goto: Timeout ${timeoutMs}ms exceeded during ${phase}; DOM readiness was not verifiable`, { cause: error });
      timeout.name = "TimeoutError";
      throw timeout;
    }
    throw error;
  }
  if (!ready.body || !ready.hero) {
    const error = new Error(
      `capture_navigation_incomplete: phase=${phase}, body=${ready.body}, hero=${ready.hero}`,
    );
    if (navigationTimedOut) error.name = "TimeoutError";
    error.code = "visual_capture_failed";
    error.retryable = true;
    throw error;
  }
  if (navigationTimedOut) {
    console.warn(`[capture-navigation] phase=${phase} status=stopped-after-timeout body=true hero=true`);
  } else {
    console.info(`[capture-navigation] phase=${phase} status=domcontentloaded body=true hero=true`);
  }
  return { phase, navigation_timed_out: navigationTimedOut, body: true, hero: true };
}

export async function waitForChromiumFonts(page, { timeoutMs = 3_000 } = {}) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(1, Number(timeoutMs || 3_000)));
    Promise.resolve(page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
    })).then(
      () => {
        clearTimeout(timer);
        resolve(true);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

// Resolve (and in serverless, download) the Chromium executable without
// launching a browser. Lets callers pay the cold pack-download cost outside
// bounded stage timers.
export async function prewarmChromium() {
  if (!isServerlessChromiumEnvironment()) return false;
  const chromiumModule = await import("@sparticuz/chromium-min");
  const chromium = chromiumModule.default ?? chromiumModule;
  if (typeof chromium.executablePath !== "function") return false;
  await serverlessExecutablePath(chromium, resolveChromiumPackUrl());
  return true;
}

export async function probeChromium() {
  const browser = await launchChromium();
  await browser.close();
  return true;
}
