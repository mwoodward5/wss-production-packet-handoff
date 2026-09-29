import test from "node:test";
import assert from "node:assert/strict";

import {
  captureWithFreshChromiumRecovery,
  classifyChromiumCaptureError,
  DEFAULT_CHROMIUM_PACK_URL,
  isServerlessChromiumEnvironment,
  isChromiumLifecycleError,
  isChromiumScreenshotProtocolError,
  isChromiumTimeoutError,
  mergeChromiumArgs,
  openChromiumPageWithRecovery,
  resolveChromiumPackUrl,
  screenshotCaptureBudgetPlan,
  waitForChromiumFonts,
} from "../../factory/lib/chromium-runtime.mjs";

test("serverless Chromium detection is explicit", () => {
  assert.equal(isServerlessChromiumEnvironment({}), false);
  assert.equal(isServerlessChromiumEnvironment({ SITEFORGE_SERVERLESS: "1" }), true);
  assert.equal(isServerlessChromiumEnvironment({ VERCEL: "1" }), true);
  assert.equal(isServerlessChromiumEnvironment({ AWS_LAMBDA_FUNCTION_NAME: "siteforge" }), true);
});

test("serverless Chromium pack has an immutable default and requires HTTPS overrides", () => {
  assert.equal(resolveChromiumPackUrl({}), DEFAULT_CHROMIUM_PACK_URL);
  assert.throws(() => resolveChromiumPackUrl({ SITEFORGE_CHROMIUM_PACK_URL: "http://example.com/pack.tar" }), /HTTPS/);
  assert.equal(
    resolveChromiumPackUrl({ SITEFORGE_CHROMIUM_PACK_URL: "https://example.com/chromium-pack.tar" }),
    "https://example.com/chromium-pack.tar",
  );
});

test("Chromium launch arguments are stable and deduplicated", () => {
  assert.deepEqual(mergeChromiumArgs(["--no-sandbox", "--disable-gpu"], ["--no-sandbox", "--mute-audio"]), [
    "--no-sandbox",
    "--disable-gpu",
    "--mute-audio",
  ]);
});

test("closed Chromium is relaunched before opening the capture page", async () => {
  let originalClosed = 0;
  let replacementLaunches = 0;
  const page = { id: "replacement-page" };
  const original = {
    async newPage() { throw new Error("browser.newPage: Target page, context or browser has been closed"); },
    async close() { originalClosed += 1; },
  };
  const replacement = {
    async newPage(options) {
      assert.deepEqual(options.viewport, { width: 1440, height: 1000 });
      return page;
    },
    async close() {},
  };

  const opened = await openChromiumPageWithRecovery(
    original,
    { viewport: { width: 1440, height: 1000 } },
    {
      launchBrowser: async () => {
        replacementLaunches += 1;
        return replacement;
      },
    },
  );

  assert.equal(opened.browser, replacement);
  assert.equal(opened.page, page);
  assert.equal(opened.recovered, true);
  assert.equal(originalClosed, 1);
  assert.equal(replacementLaunches, 1);
});

test("a second closed Chromium failure is retryable capture work", async () => {
  const closed = () => {
    const error = new Error("Target page, context or browser has been closed");
    return {
      async newPage() { throw error; },
      async close() {},
    };
  };

  await assert.rejects(
    openChromiumPageWithRecovery(closed(), {}, { launchBrowser: async () => closed() }),
    (error) => isChromiumLifecycleError(error)
      && error.code === "visual_capture_failed"
      && error.retryable === true,
  );
});

test("Chromium lifecycle errors from any capture operation are retryable", () => {
  const error = new Error("page.evaluate: Target page, context or browser has been closed");
  assert.equal(classifyChromiumCaptureError(error), error);
  assert.equal(error.code, "visual_capture_failed");
  assert.equal(error.retryable, true);

  const unrelated = new Error("packet schema is invalid");
  assert.equal(classifyChromiumCaptureError(unrelated), unrelated);
  assert.equal(unrelated.code, undefined);
  assert.equal(unrelated.retryable, undefined);
});

test("Playwright capture timeouts are retryable without weakening other failures", () => {
  const namedTimeout = new Error("page.goto: Timeout 45000ms exceeded.");
  namedTimeout.name = "TimeoutError";
  assert.equal(isChromiumTimeoutError(namedTimeout), true);
  assert.equal(classifyChromiumCaptureError(namedTimeout), namedTimeout);
  assert.equal(namedTimeout.code, "visual_capture_failed");
  assert.equal(namedTimeout.retryable, true);

  const serializedTimeout = new Error(
    'page.goto: Timeout 45000ms exceeded.\nCall log:\n  - navigating to "https://siteforge.example/__siteforge_qc__/capture/index.html?surface=static"',
  );
  assert.equal(isChromiumTimeoutError(serializedTimeout), true);
  assert.equal(classifyChromiumCaptureError(serializedTimeout), serializedTimeout);
  assert.equal(serializedTimeout.code, "visual_capture_failed");
  assert.equal(serializedTimeout.retryable, true);

  const unrelated = new Error("business source request timed out");
  assert.equal(isChromiumTimeoutError(unrelated), false);
  assert.equal(classifyChromiumCaptureError(unrelated), unrelated);
  assert.equal(unrelated.code, undefined);
  assert.equal(unrelated.retryable, undefined);
});

test("screenshot attempts reserve time for CDP and body fallbacks", () => {
  assert.deepEqual(screenshotCaptureBudgetPlan(false), {
    total: 30_000,
    playwright: 10_000,
    cdpLayout: 3_000,
    cdpScreenshot: 8_000,
  });
  assert.deepEqual(screenshotCaptureBudgetPlan(true), {
    total: 45_000,
    playwright: 18_000,
    cdpLayout: 3_000,
    cdpScreenshot: 12_000,
  });
});

test("Page.captureScreenshot unable is recognized across the same-page fallback chain", () => {
  const error = new Error(
    "page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot; "
      + "CDP fallback failed: Protocol error (Page.captureScreenshot): Unable to capture screenshot; "
      + "body capture failed: locator.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
  );
  assert.equal(isChromiumScreenshotProtocolError(error), true);
  assert.equal(isChromiumScreenshotProtocolError(new Error("packet schema is invalid")), false);
});

test("failed footer capture gets one genuinely fresh Chromium process and prepared page", async () => {
  const events = [];
  const originalPage = {
    id: "poisoned-footer-page",
    async close() { events.push("close-original-page"); },
  };
  const originalBrowser = {
    async close() { events.push("close-original-browser"); },
  };
  const replacementPage = { id: "fresh-footer-page" };
  const replacementBrowser = {
    async newPage(options) {
      events.push(`new-page:${options.viewport.width}x${options.viewport.height}`);
      return replacementPage;
    },
    async close() { events.push("close-replacement-browser"); },
  };
  let captureAttempts = 0;

  const result = await captureWithFreshChromiumRecovery({
    browser: originalBrowser,
    page: originalPage,
    pageOptions: { viewport: { width: 390, height: 844 } },
    launchBrowser: async () => {
      events.push("launch-fresh-browser");
      return replacementBrowser;
    },
    preparePage: async (page) => {
      assert.equal(page, replacementPage);
      events.push("prepare-static-footer");
    },
    capture: async (page) => {
      captureAttempts += 1;
      events.push(`capture:${page.id}`);
      if (page === originalPage) {
        throw new Error(
          "page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot; "
            + "CDP fallback failed: Protocol error (Page.captureScreenshot): Unable to capture screenshot; "
            + "body capture failed: locator.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot",
        );
      }
    },
  });

  assert.equal(result.recovered, true);
  assert.equal(result.browser, replacementBrowser);
  assert.equal(result.page, replacementPage);
  assert.equal(captureAttempts, 2);
  assert.deepEqual(events, [
    "capture:poisoned-footer-page",
    "close-original-page",
    "close-original-browser",
    "launch-fresh-browser",
    "new-page:390x844",
    "prepare-static-footer",
    "capture:fresh-footer-page",
  ]);
});

test("fresh Chromium recovery still fails closed when the replacement cannot capture", async () => {
  let launches = 0;
  const closeEvents = [];
  const replacementPage = {
    async close() { closeEvents.push("replacement-page"); },
  };
  const replacementBrowser = {
    async newPage() { return replacementPage; },
    async close() { closeEvents.push("replacement-browser"); },
  };

  await assert.rejects(
    captureWithFreshChromiumRecovery({
      browser: { async close() { closeEvents.push("original-browser"); } },
      page: { async close() { closeEvents.push("original-page"); } },
      launchBrowser: async () => {
        launches += 1;
        return replacementBrowser;
      },
      preparePage: async () => {},
      capture: async () => {
        throw new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot");
      },
    }),
    (error) => error.code === "visual_capture_failed"
      && error.retryable === true
      && /fresh Chromium recovery failed/.test(error.message),
  );
  assert.equal(launches, 1);
  assert.deepEqual(closeEvents, [
    "original-page",
    "original-browser",
    "replacement-page",
    "replacement-browser",
  ]);
});

test("fresh Chromium recovery is never used for unrelated capture failures", async () => {
  let launches = 0;
  await assert.rejects(
    captureWithFreshChromiumRecovery({
      browser: {},
      page: {},
      launchBrowser: async () => {
        launches += 1;
        return {};
      },
      preparePage: async () => {},
      capture: async () => {
        throw new Error("packet schema is invalid");
      },
    }),
    /packet schema is invalid/,
  );
  assert.equal(launches, 0);
});

test("stage abort during fresh-page preparation closes the replacement immediately", async () => {
  const controller = new AbortController();
  const abortReason = new Error("capture_mobile stage timed out");
  let replacementClosed = 0;
  let releasePrepare;
  const prepareStarted = new Promise((resolve) => {
    releasePrepare = resolve;
  });
  const replacementBrowser = {
    async newPage() {
      return { async close() {} };
    },
    async close() {
      replacementClosed += 1;
      releasePrepare();
    },
  };

  const pending = captureWithFreshChromiumRecovery({
    browser: { async close() {} },
    page: { async close() {} },
    signal: controller.signal,
    launchBrowser: async () => replacementBrowser,
    preparePage: async () => {
      await prepareStarted;
    },
    capture: async (page) => {
      if (!page.id) {
        throw new Error("Protocol error (Page.captureScreenshot): Unable to capture screenshot");
      }
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort(abortReason);

  await assert.rejects(pending, (error) => error === abortReason);
  assert.ok(replacementClosed >= 1);
});

test("font readiness is a bounded best-effort wait", async () => {
  const startedAt = Date.now();
  const stalled = await waitForChromiumFonts(
    { evaluate: async () => new Promise(() => {}) },
    { timeoutMs: 10 },
  );
  assert.equal(stalled, false);
  assert.ok(Date.now() - startedAt < 250);

  const ready = await waitForChromiumFonts(
    { evaluate: async () => undefined },
    { timeoutMs: 100 },
  );
  assert.equal(ready, true);
});
