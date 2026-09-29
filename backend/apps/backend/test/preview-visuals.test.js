"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.GHOST_AGENCY_VISUAL_SECRET = "test-visual-secret";

const {
  signVisualKey,
  visualCacheKey,
  signedVisualPath,
  verifyVisualSignature,
  generatePreviewVisuals,
  loadPlaywright,
} = require("../lib/preview-visuals");

test("cache key is stable for the same inputs", () => {
  const a = visualCacheKey({ kind: "new", previewUrl: "https://x.wss-ai.com", currentWebsite: "https://old.com", nonce: "n1" });
  const b = visualCacheKey({ kind: "new", previewUrl: "https://x.wss-ai.com", currentWebsite: "https://old.com", nonce: "n1" });
  assert.equal(a, b);
});

test("cache key differs across kinds, urls, and nonces", () => {
  const base = { previewUrl: "https://x.wss-ai.com", currentWebsite: "", nonce: "n1" };
  assert.notEqual(visualCacheKey({ ...base, kind: "new" }), visualCacheKey({ ...base, kind: "old" }));
  assert.notEqual(visualCacheKey({ ...base, kind: "new" }), visualCacheKey({ ...base, kind: "new", nonce: "n2" }));
  assert.notEqual(visualCacheKey({ ...base, kind: "new" }), visualCacheKey({ ...base, kind: "new", previewUrl: "https://y.wss-ai.com" }));
});

test("signed paths verify; tampered signatures reject", () => {
  const path = signedVisualPath({ kind: "new", previewUrl: "https://x.wss-ai.com", currentWebsite: "", nonce: "n1" });
  assert.ok(path.startsWith("/api/media/preview-shot?"));
  const qs = new URLSearchParams(path.split("?")[1]);
  assert.equal(verifyVisualSignature(qs.get("k"), qs.get("s")), true);
  assert.equal(verifyVisualSignature(qs.get("k"), "forged-signature"), false);
  assert.equal(verifyVisualSignature(qs.get("k") + "x", qs.get("s")), false);
  assert.equal(verifyVisualSignature("", ""), false);
});

test("signVisualKey is keyed by the shared visual secret", () => {
  const sig = signVisualKey("some-key");
  assert.ok(sig.length >= 16);
  assert.notEqual(sig, signVisualKey("some-other-key"));
});

test("generatePreviewVisuals degrades gracefully without playwright", () => {
  // In the default serverless/test environment playwright is absent by design.
  if (!loadPlaywright()) {
    return generatePreviewVisuals({ currentWebsite: "https://old.com", previewUrl: "https://x.wss-ai.com" })
      .then((r) => {
        assert.equal(r.ok, false);
        assert.equal(r.reason, "playwright_unavailable");
      });
  }
});

test("generatePreviewVisuals rejects non-https preview URLs", async () => {
  const r = await generatePreviewVisuals({ previewUrl: "ftp://nope" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "preview_url_missing");
});

test("route: bad signature 403s, good signature never 500s", async () => {
  const handler = require("../api/media/preview-shot");
  const mkRes = () => {
    const res = { statusCode: 0, headers: {}, body: null,
      setHeader(k, v) { this.headers[k] = v; },
      end(b) { this.body = b || ""; } };
    return res;
  };

  const bad = mkRes();
  await handler({ method: "GET", query: { k: "abc", s: "wrong" } }, bad);
  assert.equal(bad.statusCode, 403);

  const path = signedVisualPath({ kind: "new", previewUrl: "https://x.wss-ai.com", currentWebsite: "", nonce: "t1" });
  const qs = Object.fromEntries(new URLSearchParams(path.split("?")[1]).entries());
  const good = mkRes();
  await handler({ method: "GET", query: { ...qs, v: "new" } }, good);
  assert.equal(good.statusCode, 200);
  assert.ok(["image/gif", "image/jpeg"].includes(good.headers["Content-Type"]));

  const method = mkRes();
  await handler({ method: "POST", query: {} }, method);
  assert.equal(method.statusCode, 405);
});
