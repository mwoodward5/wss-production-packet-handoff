"use strict";

// test/review-face-mirror.test.js — the reviewer-face re-host.
//
// A real Google reviewer photo (googleusercontent) is fetched with an image/*
// and size guard, hashed, and hosted at the SAME object path the signed
// preview-shot URL resolves to for (previewUrl, face-<index>). Anything else is
// refused, and every failure is silent — the email falls back to a monogram.

const test = require("node:test");
const assert = require("node:assert/strict");

const { mirrorReviewFace, GOOGLE_FACE, MAX_FACE_BYTES } = require("../lib/review-face-mirror");
const { proofObjectPath } = require("../lib/proof-storage");

const PREVIEW = "https://oscars-plumbing.wss-ai.com/";
const FACE = "https://lh3.googleusercontent.com/a-/ALV-UjReal=s128-c";

function fakeRes({ ok = true, status = 200, contentType = "image/jpeg", bytes = Buffer.from("facebytes") } = {}) {
  return {
    ok,
    status,
    headers: { get: (h) => (String(h).toLowerCase() === "content-type" ? contentType : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  };
}
const okUpload = async () => ({ ok: true, bytes: 9, publicUrl: "https://x.supabase.co/o" });

test("GOOGLE_FACE matches only googleusercontent, over https", () => {
  assert.ok(GOOGLE_FACE.test(FACE));
  assert.ok(GOOGLE_FACE.test("https://lh6.googleusercontent.com/a/x"));
  assert.ok(!GOOGLE_FACE.test("https://evil.com/lh3.googleusercontent.com"));
  assert.ok(!GOOGLE_FACE.test("http://lh3.googleusercontent.com/x")); // http refused
  assert.ok(!GOOGLE_FACE.test("https://gravatar.com/x"));
});

test("happy path: fetches, hashes, and hosts at the face-0 object path", async () => {
  let uploadedPath = null;
  let uploadedType = null;
  const out = await mirrorReviewFace({
    avatarUrl: FACE,
    previewUrl: PREVIEW,
    index: 0,
    fetchImpl: async () => fakeRes({ contentType: "image/png", bytes: Buffer.from("real-face-png") }),
    upload: async (path, buf, opts) => { uploadedPath = path; uploadedType = opts && opts.contentType; return { ok: true }; },
  });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(out.sha, /^[0-9a-f]{64}$/, "a full pixel sha is returned");
  assert.equal(uploadedPath, proofObjectPath({ url: PREVIEW, variant: "face-0" }), "hosted where the signed URL resolves");
  assert.equal(uploadedType, "image/png", "content-type is carried to the upload");
});

test("index 1 hosts at face-1, distinct from face-0", async () => {
  let path = null;
  await mirrorReviewFace({ avatarUrl: FACE, previewUrl: PREVIEW, index: 1, fetchImpl: async () => fakeRes({}), upload: async (p) => { path = p; return { ok: true }; } });
  assert.equal(path, proofObjectPath({ url: PREVIEW, variant: "face-1" }));
  assert.notEqual(proofObjectPath({ url: PREVIEW, variant: "face-1" }), proofObjectPath({ url: PREVIEW, variant: "face-0" }));
});

test("a non-Google avatar is refused before any fetch or upload", async () => {
  let touched = false;
  const out = await mirrorReviewFace({
    avatarUrl: "https://cdn.example.com/face.jpg",
    previewUrl: PREVIEW,
    index: 0,
    fetchImpl: async () => { touched = true; return fakeRes({}); },
    upload: async () => { touched = true; return { ok: true }; },
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "not_a_real_google_reviewer_face");
  assert.equal(touched, false, "never reached the network");
});

test("a non-image response is refused (never hosted as a face)", async () => {
  let uploaded = false;
  const out = await mirrorReviewFace({
    avatarUrl: FACE, previewUrl: PREVIEW, index: 0,
    fetchImpl: async () => fakeRes({ contentType: "text/html" }),
    upload: async () => { uploaded = true; return { ok: true }; },
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /^not_image/);
  assert.equal(uploaded, false);
});

test("an oversize body is refused (a face is a thumbnail)", async () => {
  const big = Buffer.alloc(MAX_FACE_BYTES + 1, 1);
  const out = await mirrorReviewFace({
    avatarUrl: FACE, previewUrl: PREVIEW, index: 0,
    fetchImpl: async () => fakeRes({ bytes: big }),
    upload: okUpload,
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /^too_large/);
});

test("a fetch that throws never throws out — it degrades to a monogram", async () => {
  const out = await mirrorReviewFace({
    avatarUrl: FACE, previewUrl: PREVIEW, index: 0,
    fetchImpl: async () => { throw new Error("socket hang up"); },
    upload: okUpload,
  });
  assert.equal(out.ok, false);
  assert.ok(out.reason);
});

test("a failed upload reports not-ok, not a broken URL", async () => {
  const out = await mirrorReviewFace({
    avatarUrl: FACE, previewUrl: PREVIEW, index: 0,
    fetchImpl: async () => fakeRes({}),
    upload: async () => ({ ok: false, reason: "storage_not_configured" }),
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "storage_not_configured");
});

test("no preview URL and out-of-range index are both refused", async () => {
  const noPreview = await mirrorReviewFace({ avatarUrl: FACE, previewUrl: "", index: 0, fetchImpl: async () => fakeRes({}), upload: okUpload });
  assert.equal(noPreview.ok, false);
  assert.equal(noPreview.reason, "no_preview_url");
  const badIndex = await mirrorReviewFace({ avatarUrl: FACE, previewUrl: PREVIEW, index: 2, fetchImpl: async () => fakeRes({}), upload: okUpload });
  assert.equal(badIndex.ok, false);
  assert.equal(badIndex.reason, "index_out_of_range");
});
