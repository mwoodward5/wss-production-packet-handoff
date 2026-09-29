"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

const revealSrc = readFileSync(path.join(__dirname, "..", "api", "reveal.js"), "utf8");

// REGRESSION LOCK (2026-07-28).
//
// The outreach email's main CTA is "Open your live preview". /api/reveal used to
// resolve its redirect as:
//
//     const fallback = `${publicConfig().publicAppUrl…}/`;
//     if (payloadPreview || !buildOnClickEnabled()) {
//       return redirect(res, payloadPreview || fallback);
//     }
//
// With SITEFORGE_BUILD_ON_CLICK off, a prospect whose prebuild had not landed
// clicked that CTA and was 302'd to publicAppUrl — which serves a DIFFERENT
// product's marketing site (AnswerCrew). The prospect was promised *their* new
// website and landed on an unrelated SaaS homepage.
//
// The same clause also skipped the build-on-click branch, which already renders
// a branded WSS "building your site" loading page and can build on demand.
//
// Rule: NEVER redirect a prospect anywhere except their own preview.

test("reveal only redirects when a real preview URL exists", () => {
  // The redirect must be guarded by the preview itself, not by a feature flag.
  assert.match(
    revealSrc,
    /if\s*\(payloadPreview\)\s*\{/,
    "the Stage-1 redirect must be gated on `payloadPreview` alone",
  );
  assert.doesNotMatch(
    revealSrc,
    /if\s*\(payloadPreview\s*\|\|\s*!buildOnClickEnabled\(\)\)/,
    "the flag must not force a redirect when there is no preview",
  );
});

test("no foreign-app fallback survives in executable code", () => {
  // Strip comments so the historical explanation above reveal.js's fix does not
  // register as a live reference.
  const code = revealSrc
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");

  assert.doesNotMatch(code, /publicAppUrl/, "publicAppUrl must not be a redirect target for prospects");
  assert.doesNotMatch(
    code,
    /redirect\(\s*res\s*,\s*payloadPreview\s*\|\|/,
    "there must be no `payloadPreview || <anything>` redirect",
  );
  // The only redirect targets allowed are the prospect's own preview URLs.
  // `function redirect(res, url)` is the helper's own declaration, not a call.
  const calls = code.replace(/function\s+redirect\s*\([^)]*\)/g, "");
  const targets = [...calls.matchAll(/redirect\(\s*res\s*,\s*([A-Za-z_$][\w$.]*)/g)].map((m) => m[1]);
  assert.ok(targets.length > 0, "expected at least one redirect call");
  for (const t of targets) {
    assert.ok(
      ["payloadPreview", "existing"].includes(t),
      `redirect target "${t}" is not the prospect's own preview`,
    );
  }
});

test("a prospect with no preview still gets OUR branded loading page", () => {
  // Falling through must land on the WSS loading page, never a bare error or a
  // third-party site.
  assert.match(revealSrc, /function loadingPage\(/, "the branded loading page must exist");
  assert.match(
    revealSrc,
    /res\.end\(loadingPage\(/,
    "the no-preview path must serve the branded loading page",
  );
  assert.match(revealSrc, /Building the website for/, "loading page must name the business");
});
