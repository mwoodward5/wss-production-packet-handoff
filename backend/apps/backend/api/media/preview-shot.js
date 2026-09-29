"use strict";

// GET /api/media/preview-shot?k=<cacheKey>&s=<sig>&v=old|new|gif[&si=&ri=&bh=]
// Signed, CDN-cacheable, same-origin visual assets for outreach emails.
//
// This route is a READ-THROUGH PROXY and nothing else. It verifies the
// signature, derives the storage path, fetches the pre-captured JPEG from the
// public 'wss-proof-assets' bucket, and streams it back.
//
// It does NOT capture. The previous version called generatePreviewVisuals()
// inline, which needs Playwright's Chromium — a ~1.4 GB machine-level browser
// cache that never lives in node_modules and therefore can never be inside a
// Vercel lambda. The capture failed on every single request and the route fell
// through to its 42-byte spacer, so every "before/after" image ever emailed was
// an invisible pixel that looked like a healthy HTTP 200.
//
// Capture now runs off the request path: scripts/capture-proof-shots.js, on a
// machine with a real browser, writing to the same object keys this route reads.
// Nothing here may ever require playwright again — that is the whole fix.
//
// Miss policy: a missing object is a SHORT-cached spacer, never a 500 and never
// a week-long cache, so the image self-heals the moment the capture lands.

const { verifySignedVisualRequest, SPACER_GIF } = require("../../lib/preview-visuals");
const {
  proofObjectPath,
  proofMetaPath,
  capturedShotBelongsTo,
  urlForVariant,
  normalizeVariant,
  fetchProofShot,
} = require("../../lib/proof-storage");

const WEEK = 60 * 60 * 24 * 7;
const RETRY_AFTER_SECONDS = 300;

// In-memory warm cache per lambda instance (objects are immutable per key).
const warm = new Map();
const WARM_CAP = 200;

function sendBuffer(res, buf, contentType, maxAge) {
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Length", String(buf.length));
  res.setHeader("Cache-Control", `public, max-age=${maxAge}, s-maxage=${maxAge}, immutable`);
  res.end(buf);
}

function sendSpacer(res, retryable = true, reason = "") {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/gif");
  res.setHeader(
    "Cache-Control",
    retryable ? `public, max-age=${RETRY_AFTER_SECONDS}` : `public, max-age=${WEEK}`,
  );
  // Debug-only breadcrumb: why an email is showing a blank pixel is otherwise
  // invisible, because a spacer and a real shot are both HTTP 200.
  if (reason) res.setHeader("X-Proof-Shot", String(reason).slice(0, 80));
  res.end(SPACER_GIF);
}

// Decode the key back into its parts (mirrors visualCacheKey layout).
function decodeKey(key = "") {
  const [kind = "", urlB64 = "", siteB64 = "", nonce = ""] = String(key).split(".");
  const dec = (s) => {
    try { return Buffer.from(s, "base64url").toString("utf8"); } catch { return ""; }
  };
  return { kind, previewUrl: dec(urlB64), currentWebsite: dec(siteB64), nonce };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.statusCode = 405;
    return res.end("method_not_allowed");
  }

  const { k, s, v = "new", si, ri, bh } = req.query || {};
  const signedRequest = verifySignedVisualRequest({ k, s, si, ri, bh });
  if (!k || !signedRequest.ok) {
    res.statusCode = 403;
    return res.end("bad_signature");
  }

  const { kind: signedKind, previewUrl, currentWebsite } = decodeKey(k);
  if (!/^https:\/\//i.test(previewUrl || "")) return sendSpacer(res, false, "no_preview_url");

  const variant = normalizeVariant(v);
  // `v` selects the storage object. The signed key already carries the kind,
  // so the two must name the same allowlisted variant. Comparing the key's
  // historical 8-character kind segment preserves every valid legacy/mobile
  // URL while refusing a changed new->old/gif/face selector before any read.
  const rawVariant = typeof v === "string" ? v : "";
  if (rawVariant !== variant || String(variant).slice(0, 8) !== signedKind) {
    res.statusCode = 403;
    return res.end("bad_signature");
  }

  // Old-site shot requested but no current website on file: permanently a spacer.
  const subject = urlForVariant({ variant, previewUrl, currentWebsite });
  if (!/^https?:\/\//i.test(subject || "")) return sendSpacer(res, false, "no_subject_url");

  const objectPath = proofObjectPath({
    url: subject,
    variant,
    ...(signedRequest.proofIdentity ? { proofIdentity: signedRequest.proofIdentity } : {}),
  });
  if (!objectPath) return sendSpacer(res, false, "unkeyable_url");

  // IDENTITY GATE — "before" shots only. A JPEG at the right key still proves
  // only that SOMETHING was photographed at the URL we aimed at; a redirect to
  // a parked page, a resold domain or a franchise portal produces a perfectly
  // healthy screenshot of a stranger's website. The sidecar records where the
  // browser actually landed, and serving a picture we cannot tie to this
  // prospect's own domain is exactly the defect this route is here to stop.
  //
  // NOT applied to "new": that variant is a picture of our own mirror, whose
  // URL we control and whose host guard already lives in preview-host-guard.js.
  if (/^old(-|$)/.test(variant)) {
    let identity;
    try {
      const metaHit = await fetchProofShot(proofMetaPath({ url: subject, variant }));
      const meta = metaHit.ok ? JSON.parse(metaHit.buffer.toString("utf8")) : null;
      identity = capturedShotBelongsTo({
        capturedUrl: meta && (meta.captured_url || meta.requested_url),
        expectedWebsite: currentWebsite,
      });
    } catch {
      identity = { ok: false, reason: "capture_source_unreadable" };
    }
    // Retryable: an unrecorded source self-heals the moment the shot is
    // re-captured by a writer that stores the sidecar. A genuine domain
    // mismatch is not a caching problem, but the short cache costs nothing and
    // keeps one policy for the whole gate.
    if (!identity.ok) return sendSpacer(res, true, `before_shot_${identity.reason}`);
  }

  // The warm key includes the caller's content fingerprint (`c`). Object keys
  // are derived from the URL, so a rebuilt mirror writes NEW bytes to the SAME
  // key — an objectPath-only cache then serves the pre-rebuild picture for the
  // life of the instance. `c` changes exactly when the pixels change.
  const bust = /^[0-9a-f]{6,64}$/i.test(String((req.query || {}).c || "")) ? String(req.query.c) : "";
  const warmKey = bust ? `${objectPath}#${bust}` : objectPath;
  if (warm.has(warmKey)) {
    const hit = warm.get(warmKey);
    return sendBuffer(res, hit.buf, hit.type, WEEK);
  }

  // The digest goes DOWN to the storage read as well, not just into the warm
  // key. Without it the lambda re-fetched the identical Supabase object URL and
  // that CDN — which holds shots for a week — answered with the pre-rebuild
  // picture, so a freshly re-captured mirror still emailed its old hero.
  let stored;
  try {
    stored = await fetchProofShot(objectPath, { bust });
  } catch {
    stored = { ok: false, reason: "storage_error" };
  }

  // Not captured yet (or storage hiccup): short cache so the next request retries.
  if (!stored || stored.ok !== true || !stored.buffer || !stored.buffer.length) {
    return sendSpacer(res, true, (stored && stored.reason) || "not_captured");
  }

  const type = /^image\//i.test(stored.contentType || "") ? stored.contentType : "image/jpeg";
  if (warm.size >= WARM_CAP) warm.delete(warm.keys().next().value);
  warm.set(warmKey, { buf: stored.buffer, type });
  return sendBuffer(res, stored.buffer, type, WEEK);
};
