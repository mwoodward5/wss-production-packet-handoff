import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { prepareOptionalGoogleMapEvidence } from "../../factory/pipeline/05-build-v8.mjs";

test("optional Google map scroll is bounded and its response waiter settles on timeout", async () => {
  const timeout = new Error("locator.scrollIntoViewIfNeeded: Timeout 29562ms exceeded.");
  timeout.name = "TimeoutError";
  let requestedTimeout = 0;
  let responseSettled = false;
  const map = {
    async scrollIntoViewIfNeeded(options) {
      requestedTimeout = options.timeout;
      throw timeout;
    },
  };
  const pendingMapResponse = Promise.resolve(null).then((value) => {
    responseSettled = true;
    return value;
  });

  const result = await prepareOptionalGoogleMapEvidence(map, pendingMapResponse);

  assert.equal(requestedTimeout, 5_000);
  assert.equal(responseSettled, true);
  assert.equal(result.pass, false);
  assert.match(result.detail, /Google map evidence scroll was unavailable/);
  assert.match(result.detail, /Timeout 29562ms exceeded/);
});

test("desktop map scroll timeout falls through to Esri while page screenshots remain required", () => {
  const renderer = readFileSync(
    new URL("../../factory/pipeline/05-build-v8.mjs", import.meta.url),
    "utf8",
  );
  const start = renderer.indexOf("export async function captureScreenshotsForViewport");
  const end = renderer.indexOf("\nexport function finalizeScreenshotManifest", start);
  const source = renderer.slice(start, end);
  const optionalScroll = source.indexOf(
    "const mapScroll = await prepareOptionalGoogleMapEvidence(map, pendingMapResponse);",
  );
  const esriFallback = source.indexOf(
    "if (!mapEvidence.pass) mapEvidence = await writeEsriSatelliteEvidence(page, screenshotRoot);",
  );
  const heroCapture = source.indexOf("await captureStill(heroRel);");

  assert.ok(optionalScroll > -1);
  assert.ok(esriFallback > optionalScroll);
  assert.ok(heroCapture > esriFallback);
  assert.match(source, /if \(!mapScroll\.pass\) \{/);
  assert.doesNotMatch(source, /await map\.scrollIntoViewIfNeeded\(\);/);
  assert.match(source, /await mapFrame\.boundingBox\(\{ timeout: 5_000 \}\);/);
  assert.match(source, /mapFrame\.screenshot\(\{ path: mapPath, timeout: 5000 \}\)/);
  assert.match(source, /throw new Error\(`Screenshot capture is empty or truncated: \$\{relativePath\}`\);/);
});
