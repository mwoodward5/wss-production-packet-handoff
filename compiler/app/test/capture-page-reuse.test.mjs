import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const renderer = readFileSync(
  new URL("../../factory/pipeline/05-build-v8.mjs", import.meta.url),
  "utf8",
);

function captureViewportSource() {
  const start = renderer.indexOf("export async function captureScreenshotsForViewport");
  const end = renderer.indexOf("\nexport function finalizeScreenshotManifest", start);
  assert.notEqual(start, -1, "captureScreenshotsForViewport must exist");
  assert.notEqual(end, -1, "captureScreenshotsForViewport must have a bounded source block");
  return renderer.slice(start, end);
}

test("static capture reuses the healthy page and only relaunches through bounded recovery", () => {
  const source = captureViewportSource();
  assert.match(source, /let captureIndexOverride = null;/);
  assert.match(
    source,
    /body: captureIndexOverride !== null && filePath === indexPath\s+\? Buffer\.from\(captureIndexOverride\)/,
  );

  const staticHtml = source.indexOf("captureIndexOverride = staticCapture.html;");
  const staticNavigation = source.indexOf(
    "await navigateCapturePhase(`${captureRoute.url}?surface=static`",
    staticHtml,
  );
  assert.ok(staticHtml > -1, "the static HTML must replace the routed index source");
  assert.ok(staticNavigation > staticHtml, "the same routed URL must be navigated after the override");

  const transition = source.slice(
    source.indexOf("const staticCapture = buildStaticCaptureHtml"),
    staticNavigation,
  );
  assert.doesNotMatch(
    transition,
    /page\.close|newPage|openChromiumPageWithRecovery/,
    "the healthy evidence-to-static transition must not directly hand off to another page",
  );
  assert.equal(
    [...source.matchAll(/openChromiumPageWithRecovery\(/g)].length,
    1,
    "only the initial capture page may be opened",
  );
});

test("same-page reuse preserves all screenshot artifact gates", () => {
  const source = captureViewportSource();
  assert.match(source, /const heroRel = `screenshots\/\$\{viewportName\}\/hero\.png`;/);
  assert.match(source, /Object\.entries\(\{ mid: 820, footer: 1600 \}\)/);
  assert.match(source, /await scrollToCaptureFold\(page, y\);/);
  assert.match(source, /const fullRel = `screenshots\/\$\{viewportName\}\/full\.png`;/);
  assert.equal([...source.matchAll(/await captureStill\(/g)].length, 3);
  assert.match(source, /await stablePageScreenshot\(targetPage, outputPath, \{ fullPage \}\);/);
  assert.equal([...source.matchAll(/captureError\.code = "visual_capture_failed";/g)].length, 3);

  assert.match(
    renderer,
    /"screenshots\/desktop\/hero\.png", "screenshots\/desktop\/mid\.png", "screenshots\/desktop\/footer\.png", "screenshots\/desktop\/full\.png"/,
  );
  assert.match(
    renderer,
    /"screenshots\/mobile\/hero\.png", "screenshots\/mobile\/mid\.png", "screenshots\/mobile\/footer\.png", "screenshots\/mobile\/full\.png"/,
  );
  assert.match(renderer, /if \(!existsSync\(absolutePath\)\) throw new Error\(`Screenshot capture missing/);
  assert.match(renderer, /if \(size < 1024\) throw new Error\(`Screenshot capture is empty or truncated/);
});

test("failed still capture gets one fresh static page without weakening requested fold semantics", () => {
  const source = captureViewportSource();
  assert.match(source, /let freshCaptureRecoveryUsed = false;/);
  assert.match(source, /allowRecovery: !freshCaptureRecoveryUsed,/);
  assert.match(source, /freshCaptureRecoveryUsed = true;/);
  assert.match(source, /captureWithFreshChromiumRecovery\(\{/);
  assert.match(source, /pageOptions: \{ viewport \},/);
  assert.match(source, /\?surface=static&recovery=fresh/);
  assert.match(source, /await installCaptureRoute\(targetPage\);/);
  assert.match(source, /await freezeMapEmbedsForCapture\(targetPage\);/);
  assert.match(source, /await freezeCaptureMotion\(targetPage\);/);
  assert.match(source, /await hydrateLazyMedia\(targetPage\);/);
  assert.match(source, /await captureStill\(rel, \{ foldY: y \}\);/);
  assert.match(source, /await captureStill\(fullRel, \{ fullPage: true \}\);/);
  assert.match(source, /rmSync\(outputPath, \{ force: true \}\);/);
  assert.match(
    source,
    /if \(!existsSync\(outputPath\) \|\| statSync\(outputPath\)\.size < 1024\)/,
  );
});
