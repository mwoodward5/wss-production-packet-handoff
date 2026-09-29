import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  DEFAULT_CAPTURE_ORIGIN,
  captureContentType,
  createCaptureRoute,
  resolveCaptureFile,
  resolveCaptureOrigin,
} from "../../factory/lib/capture-origin.mjs";

test("capture uses the configured public HTTPS origin so map referrer checks are real", () => {
  assert.equal(resolveCaptureOrigin({ SITEFORGE_CAPTURE_ORIGIN: "https://siteforge.example.com/private/path" }), "https://siteforge.example.com");
  assert.equal(resolveCaptureOrigin({ SITEFORGE_CAPTURE_ORIGIN: "http://localhost:8787" }), DEFAULT_CAPTURE_ORIGIN);
  assert.equal(resolveCaptureOrigin({ SITEFORGE_PUBLIC_URL: "siteforge.example.com" }), "https://siteforge.example.com");
  assert.equal(resolveCaptureOrigin({ VERCEL_URL: "untrusted-preview.vercel.app" }), DEFAULT_CAPTURE_ORIGIN);
  assert.equal(
    resolveCaptureOrigin({ VERCEL_URL: "siteforge-bszadc40x-rocketsites.vercel.app" }),
    "https://siteforge-bszadc40x-rocketsites.vercel.app",
  );
  assert.equal(
    resolveCaptureOrigin({ VERCEL_URL: "siteforge-app-git-fix-capture-abc123-rocketsites.vercel.app" }),
    "https://siteforge-app-git-fix-capture-abc123-rocketsites.vercel.app",
  );
});

test("capture route maps only files inside the generated site", () => {
  const root = path.resolve("generated-sites", "capture-test");
  const route = createCaptureRoute(root, "abc123def456", { SITEFORGE_CAPTURE_ORIGIN: "https://siteforge.example.com" });
  assert.equal(route.url, "https://siteforge.example.com/__siteforge_qc__/abc123def456/index.html");
  assert.equal(resolveCaptureFile(root, route.url, route.prefix), path.join(root, "index.html"));
  assert.equal(resolveCaptureFile(root, `${route.origin}${route.prefix}media/hero.webp`, route.prefix), path.join(root, "media", "hero.webp"));
  assert.equal(resolveCaptureFile(root, `${route.origin}${route.prefix}..%2F..%2Fsecret.txt`, route.prefix), null);
  assert.equal(captureContentType("hero.webp"), "image/webp");
});

test("capture route accepts the active Vercel preview deployment instead of the retired default", () => {
  const route = createCaptureRoute("generated-sites/capture-preview", "fed987cba654", {
    VERCEL_URL: "siteforge-live-preview-rocketsites.vercel.app",
  });
  assert.equal(route.origin, "https://siteforge-live-preview-rocketsites.vercel.app");
  assert.equal(route.url, "https://siteforge-live-preview-rocketsites.vercel.app/__siteforge_qc__/fed987cba654/index.html");
});
