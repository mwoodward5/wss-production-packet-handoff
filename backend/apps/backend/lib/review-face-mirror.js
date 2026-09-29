"use strict";

// lib/review-face-mirror.js — re-host a Google reviewer face to a first-party
// object so the outreach email can show a REAL face.
//
// WHY THIS EXISTS. The build stores each reviewer face as a googleusercontent
// URL and the mirror SITE renders it straight from Google's CDN. The email
// cannot: Gmail refuses to load third-party images, and the email's first-party
// image law allows only *.wss-ai.com <img> hosts (test/email-truth-packet-adapter,
// test/email-recipient-safety). So the face bytes are fetched and re-hosted
// through the SAME signed /api/media/preview-shot path the proof screenshots
// use — keyed as face-0 / face-1 on the preview URL, so api/media/preview-shot
// resolves them with no route change (proof-storage VARIANTS + preview-visuals
// both learn the two kinds; that is the whole wiring on the serve side).
//
// TRUTH LAW. Only a real Google reviewer photo is mirrored — the upstream miner
// already gates avatarUrl on isGoogleReviewerFace + google_places_api provenance,
// and this refuses anything that is not a googleusercontent URL. The face is
// shown next to THAT reviewer's own quote, attribution preserved, exactly as the
// mirror rail shows it; it is never relabelled or shown as the client/owner. A
// failure is SILENT — the caller falls back to the reviewer's initial (monogram),
// which is what every email shipped before this feature.
//
// Never throws.

const { createHash } = require("node:crypto");
const { proofObjectPath, uploadProofShot } = require("./proof-storage");
const { isGoogleReviewerFace } = require("./verified-trust-lookup");

// Matches the upstream face gate (host *.googleusercontent.com). A face on any
// other host is refused here rather than re-hosted — we only ever re-serve bytes
// Google already served publicly for this review.
const GOOGLE_FACE = /^https:\/\/(?:[a-z0-9-]+\.)*googleusercontent\.com\//i;
// A profile thumbnail is a few KB; anything past this is not a face and is
// refused rather than hosted (fetchBytes has no cap of its own, and these bytes
// come from an arbitrary third-party URL).
const MAX_FACE_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 4000;

async function fetchFaceBytes(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
    if (!res || res.ok !== true) return { ok: false, reason: `http_${res && res.status}` };
    const contentType = String((res.headers && res.headers.get && res.headers.get("content-type")) || "");
    if (!/^image\//i.test(contentType)) return { ok: false, reason: `not_image:${contentType.slice(0, 40)}` };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) return { ok: false, reason: "empty_body" };
    if (buffer.length > MAX_FACE_BYTES) return { ok: false, reason: `too_large:${buffer.length}` };
    return { ok: true, buffer, contentType };
  } catch (err) {
    return { ok: false, reason: String((err && err.message) || err).slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * mirrorReviewFace({ avatarUrl, previewUrl, index }) ->
 *   { ok:true, sha, bytes } | { ok:false, reason }
 *
 * Fetches the Google face and hosts it at the face-<index> object for previewUrl
 * (idempotent upsert — same key every send). Returns the pixel sha, which the
 * email uses as the cache-bust and as the evidence the object exists. The object
 * path here is proofObjectPath({url: previewUrl, variant}) — the EXACT path the
 * signed /api/media/preview-shot URL resolves to for the same (previewUrl,
 * variant), so writer and reader never have to talk.
 */
async function mirrorReviewFace({
  avatarUrl = "",
  previewUrl = "",
  index = 0,
  fetchImpl = fetch,
  upload = uploadProofShot,
  fetchBytes = fetchFaceBytes,
} = {}) {
  const src = String(avatarUrl || "").trim();
  if (!GOOGLE_FACE.test(src) || !isGoogleReviewerFace(src)) return { ok: false, reason: "not_a_real_google_reviewer_face" };
  if (!previewUrl) return { ok: false, reason: "no_preview_url" };
  if (!(index === 0 || index === 1)) return { ok: false, reason: "index_out_of_range" };
  const variant = `face-${index}`;
  const objectPath = proofObjectPath({ url: previewUrl, variant });
  if (!objectPath) return { ok: false, reason: "no_object_path" };
  const got = await fetchBytes(src, fetchImpl);
  if (!got.ok) return { ok: false, reason: got.reason };
  const sha = createHash("sha256").update(got.buffer).digest("hex");
  const up = await upload(objectPath, got.buffer, { contentType: got.contentType || "image/jpeg" });
  if (!up || up.ok !== true) return { ok: false, reason: (up && up.reason) || "upload_failed" };
  return { ok: true, sha, bytes: got.buffer.length };
}

module.exports = { mirrorReviewFace, fetchFaceBytes, GOOGLE_FACE, MAX_FACE_BYTES };
