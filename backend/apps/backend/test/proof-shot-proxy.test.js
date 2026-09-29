"use strict";

// The before/after images in every outreach email are served by
// /api/media/preview-shot. For over a month that route returned a healthy
// HTTP 200 carrying a 42-byte transparent spacer, because it tried to capture
// the screenshot inline with Playwright — a browser that cannot exist in a
// lambda. These tests pin the shape that fixed it: capture is somebody else's
// job, the route only reads, and both halves agree on the object key.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.GHOST_AGENCY_VISUAL_SECRET = "test-visual-secret";

const {
  normalizeProofUrl,
  proofObjectPath,
  urlForVariant,
  publicProofUrl,
  PROOF_BUCKET,
} = require("../lib/proof-storage");
const { signedVisualPath, SPACER_GIF } = require("../lib/preview-visuals");

const ROUTE_PATH = path.join(__dirname, "..", "api", "media", "preview-shot.js");

function mkRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b === undefined ? "" : b; },
  };
}

function qsFor({ kind, previewUrl, currentWebsite, nonce }) {
  const p = signedVisualPath({ kind, previewUrl, currentWebsite, nonce });
  return Object.fromEntries(new URLSearchParams(p.split("?")[1]).entries());
}

test("the route never pulls a browser into the lambda", () => {
  const src = fs.readFileSync(ROUTE_PATH, "utf8");
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(/require\(["'][^"']*playwright/.test(code), false, "route must not require playwright");
  assert.equal(/generatePreviewVisuals/.test(code), false, "route must not call the capture path");
});

test("url normalization folds only the harmless differences", () => {
  const canonical = "https://example.com/roofing";
  for (const spelling of [
    "https://example.com/roofing",
    "https://www.example.com/roofing",
    "http://Example.COM/roofing",
    "https://example.com/roofing/",
    "https://example.com//roofing#quote",
    "example.com/roofing",
  ]) {
    assert.equal(normalizeProofUrl(spelling), canonical, `failed for ${spelling}`);
  }
  assert.equal(normalizeProofUrl("https://example.com/"), "https://example.com");
  assert.equal(normalizeProofUrl("https://example.com?b=2&a=1"), "https://example.com?a=1&b=2");
  assert.equal(
    normalizeProofUrl("https://example.com/?b=2&a=1"),
    normalizeProofUrl("https://www.example.com?a=1&b=2"),
  );
  // Different sites must not collide.
  assert.notEqual(normalizeProofUrl("https://a.example.com"), normalizeProofUrl("https://b.example.com"));
  assert.equal(normalizeProofUrl("ftp://nope.com"), "");
  assert.equal(normalizeProofUrl(""), "");
});

test("object paths are stable, variant-scoped, and content-addressed", () => {
  const a = proofObjectPath({ url: "https://www.example.com/", variant: "new" });
  const b = proofObjectPath({ url: "http://example.com", variant: "new" });
  assert.equal(a, b, "normalized spellings must share one object");
  assert.match(a, /^preview-shots\/new\/[0-9a-f]{64}\.jpg$/);
  assert.notEqual(a, proofObjectPath({ url: "https://example.com", variant: "old" }));
  assert.notEqual(a, proofObjectPath({ url: "https://other.com", variant: "new" }));
  assert.equal(proofObjectPath({ url: "not a url", variant: "new" }), "");
});

test("old shoots the current website, new and gif shoot the mirror", () => {
  const args = { previewUrl: "https://mirror.wss-ai.com/", currentWebsite: "https://old.example.com" };
  assert.equal(urlForVariant({ variant: "old", ...args }), "https://old.example.com");
  assert.equal(urlForVariant({ variant: "new", ...args }), "https://mirror.wss-ai.com/");
  assert.equal(urlForVariant({ variant: "gif", ...args }), "https://mirror.wss-ai.com/");
  // Unknown variants must not silently become the "old" shot.
  assert.equal(urlForVariant({ variant: "bogus", ...args }), "https://mirror.wss-ai.com/");
});

test("public url points at the public bucket path", () => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  delete process.env.WSS_PROOF_ASSETS_BASE_URL;
  assert.equal(
    publicProofUrl("preview-shots/new/abc.jpg"),
    `https://proj.supabase.co/storage/v1/object/public/${PROOF_BUCKET}/preview-shots/new/abc.jpg`,
  );
});

test("a stored object is streamed back as a real image with a long cache", async () => {
  const handler = require("../api/media/preview-shot");
  const jpeg = Buffer.alloc(4096, 7);
  const realFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
  });
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "new", previewUrl: "https://stored.wss-ai.com/", currentWebsite: "", nonce: "s1" }) }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "image/jpeg");
    assert.equal(res.body.length, 4096);
    assert.match(res.headers["Cache-Control"], /max-age=604800/);
  } finally {
    global.fetch = realFetch;
  }
});

test("a missing object degrades to a SHORT-cached spacer, never a 500", async () => {
  const handler = require("../api/media/preview-shot");
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) });
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "new", previewUrl: "https://never-captured.wss-ai.com/", currentWebsite: "", nonce: "s2" }) }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "image/gif");
    assert.equal(res.body.length, SPACER_GIF.length);
    // The whole point of the short cache: the image self-heals once captured.
    assert.match(res.headers["Cache-Control"], /max-age=300\b/);
    assert.equal(/immutable/.test(res.headers["Cache-Control"]), false);
  } finally {
    global.fetch = realFetch;
  }
});

test("a thrown storage error is still a 200 spacer", async () => {
  const handler = require("../api/media/preview-shot");
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error("network down"); };
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "new", previewUrl: "https://boom.wss-ai.com/", currentWebsite: "", nonce: "s3" }) }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "image/gif");
  } finally {
    global.fetch = realFetch;
  }
});

test("signature gate still holds and old-with-no-current-site is a permanent spacer", async () => {
  const handler = require("../api/media/preview-shot");

  const forged = mkRes();
  await handler({ method: "GET", query: { k: "abc", s: "wrong" } }, forged);
  assert.equal(forged.statusCode, 403);

  const wrongMethod = mkRes();
  await handler({ method: "POST", query: {} }, wrongMethod);
  assert.equal(wrongMethod.statusCode, 405);

  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error("must not be called"); };
  try {
    const res = mkRes();
    await handler({ method: "GET", query: { ...qsFor({ kind: "old", previewUrl: "https://mirror.wss-ai.com/", currentWebsite: "", nonce: "s4" }) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "image/gif");
    assert.match(res.headers["Cache-Control"], /max-age=604800/);
  } finally {
    global.fetch = realFetch;
  }
});

test("before and after resolve to DIFFERENT objects", () => {
  const previewUrl = "https://wss-test-x.wss-ai.com/";
  const currentWebsite = "https://theirsite.com";
  const oldPath = proofObjectPath({ url: urlForVariant({ variant: "old", previewUrl, currentWebsite }), variant: "old" });
  const newPath = proofObjectPath({ url: urlForVariant({ variant: "new", previewUrl, currentWebsite }), variant: "new" });
  assert.notEqual(oldPath, newPath);
});
