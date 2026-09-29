import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  captureWithFreshChromiumRecovery,
  navigateChromiumPageForCapture,
} from "../../factory/lib/chromium-runtime.mjs";
import { buildStaticCaptureHtml } from "../../factory/pipeline/05-build-v8.mjs";

function captureReadyPage({ gotoError = null, ready = { body: true, hero: true } } = {}) {
  const events = [];
  const session = {
    async send(method) {
      events.push(method);
      assert.equal(method, "Page.stopLoading");
    },
    async detach() {
      events.push("detach");
    },
  };
  return {
    events,
    async goto(_url, options) {
      events.push(`goto:${options.waitUntil}:${options.timeout}`);
      if (gotoError) throw gotoError;
    },
    context() {
      return { async newCDPSession() { return session; } };
    },
    async evaluate() {
      events.push("evaluate-readiness");
      return ready;
    },
    async close() {
      events.push("close");
    },
  };
}

test("DOMContentLoaded timeout stops loading only when visible hero proof is ready", async () => {
  const timeout = new Error("page.goto: Timeout 45000ms exceeded.");
  timeout.name = "TimeoutError";
  const page = captureReadyPage({ gotoError: timeout });

  const result = await navigateChromiumPageForCapture(
    page,
    "https://siteforge.invalid/capture?surface=static",
    { phase: "mobile:static", timeoutMs: 45_000, operationTimeoutMs: 500 },
  );

  assert.equal(result.navigation_timed_out, true);
  assert.deepEqual(page.events, [
    "goto:domcontentloaded:45000",
    "Page.stopLoading",
    "detach",
    "evaluate-readiness",
  ]);
});

test("navigation fails closed when body or visible hero proof is missing", async () => {
  const page = captureReadyPage({ ready: { body: true, hero: false } });
  await assert.rejects(
    navigateChromiumPageForCapture(page, "https://siteforge.invalid/capture", { phase: "desktop:initial" }),
    (error) => error.code === "visual_capture_failed"
      && error.retryable === true
      && /body=true, hero=false/.test(error.message),
  );
});

test("closed capture navigation relaunches exactly one fresh browser", async () => {
  const closed = new Error("page.goto: Target page, context or browser has been closed");
  const originalPage = captureReadyPage({ gotoError: closed });
  const replacementPage = captureReadyPage();
  let launches = 0;
  const replacementBrowser = {
    async newPage() { return replacementPage; },
    async close() {},
  };

  const result = await captureWithFreshChromiumRecovery({
    browser: { async close() {} },
    page: originalPage,
    pageOptions: { viewport: { width: 390, height: 844 } },
    launchBrowser: async () => {
      launches += 1;
      return replacementBrowser;
    },
    preparePage: async () => {},
    capture: (page) => navigateChromiumPageForCapture(
      page,
      "https://siteforge.invalid/capture",
      { phase: "mobile:initial", operationTimeoutMs: 500 },
    ),
  });

  assert.equal(result.recovered, true);
  assert.equal(result.page, replacementPage);
  assert.equal(launches, 1);
});

test("static capture strips executable scripts but preserves CSS, media, and JSON-LD", () => {
  const live = `<!doctype html><html><head>
    <style>.hero{min-height:500px}</style>
    <script src="https://slow.example/hang.js"></script>
    <script type="module">await new Promise(() => {})</script>
    <script type="application/ld+json">{"@type":"LocalBusiness"}</script>
  </head><body>
    <section class="hero" data-hero-anatomy="arrival"><h1>Real business</h1><img src="hero.jpg"><video src="hero.mp4"></video></section>
    <script>while(false){}</script>
  </body></html>`;

  const result = buildStaticCaptureHtml(live);

  assert.doesNotMatch(result.html, /slow\.example|type="module"|while\(false\)/);
  assert.match(result.html, /<style>\.hero\{min-height:500px\}<\/style>/);
  assert.match(result.html, /<img src="hero\.jpg">/);
  assert.match(result.html, /<video src="hero\.mp4"><\/video>/);
  assert.match(result.html, /<script type="application\/ld\+json">\{"@type":"LocalBusiness"\}<\/script>/);
  assert.match(result.html, /siteforge-capture-static/);
});

test("both navigation phases use recovery and all four screenshot proof calls remain hard gates", () => {
  const renderer = readFileSync(
    new URL("../../factory/pipeline/05-build-v8.mjs", import.meta.url),
    "utf8",
  );
  const start = renderer.indexOf("export async function captureScreenshotsForViewport");
  const end = renderer.indexOf("\nexport function finalizeScreenshotManifest", start);
  const source = renderer.slice(start, end);

  assert.match(source, /navigateCapturePhase\(captureRoute\.url, `\$\{viewportName\}:initial`\)/);
  assert.match(source, /navigateCapturePhase\(`\$\{captureRoute\.url\}\?surface=static`, `\$\{viewportName\}:static`\)/);
  assert.equal([...source.matchAll(/await captureStill\(/g)].length, 3);
  assert.match(source, /Object\.entries\(\{ mid: 820, footer: 1600 \}\)/);
  assert.match(source, /allowRecovery: !freshCaptureRecoveryUsed,/);
  assert.equal([...source.matchAll(/await waitForChromiumFonts\(/g)].length, 3);
  assert.doesNotMatch(source, /document\.fonts\?\.ready/);
  assert.match(source, /if \(!existsSync\(outputPath\) \|\| statSync\(outputPath\)\.size < 1024\)/);
});
