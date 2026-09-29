"use strict";

// test/before-image-identity.test.js — WHOSE SITE IS THE "BEFORE" A PICTURE OF?
//
// Byte-verifying an image proves it is a JPEG. It does not prove it is the
// RIGHT business's website. The panel is captioned "YOUR SITE TODAY", so a
// screenshot of a parked page, a resold domain, a franchise portal or another
// company's homepage under that caption is a lie told in the prospect's name —
// the same defect class as a stale preview from a different business, and it
// gets the same answer: refuse to attach, refuse to send.
//
// The gap being closed is mundane and real: the storage key is derived from the
// URL we MEANT to photograph, while the bytes come from wherever the browser
// actually LANDED. Nothing recorded the difference, so nothing could check it.
// Now the capture records the landing URL beside the image, and three readers
// enforce one rule from it — the writer, the proxy, and the compose path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.GHOST_AGENCY_VISUAL_SECRET = "test-visual-secret";
// The proxy reads through public storage; without a configured base it would
// never call fetch at all and every assertion below would pass for the wrong
// reason (storage_not_configured rather than an identity verdict).
process.env.WSS_PROOF_ASSETS_BASE_URL = "https://proof.example.test/assets";

const {
  registrableDomain,
  capturedShotBelongsTo,
  proofObjectPath,
  proofMetaPath,
} = require("../lib/proof-storage");
const { proofReadiness } = require("../lib/outreach-email-v2");
const { signedVisualPath, SPACER_GIF } = require("../lib/preview-visuals");

// ---------------------------------------------------------------------------
// 1. The rule itself
// ---------------------------------------------------------------------------

test("registrable domain folds subdomains and www, and never folds two businesses together", () => {
  assert.equal(registrableDomain("https://www.Flint-Plumb.com/austin"), "flint-plumb.com");
  assert.equal(registrableDomain("https://booking.flint-plumb.com/"), "flint-plumb.com");
  assert.equal(registrableDomain("flint-plumb.com"), "flint-plumb.com");
  // Multi-label public suffixes are not two businesses sharing a domain.
  assert.equal(registrableDomain("https://www.acme.co.uk/x"), "acme.co.uk");
  assert.equal(registrableDomain("https://shop.acme.com.au"), "acme.com.au");
  // Different businesses stay different.
  assert.notEqual(registrableDomain("https://flint-plumb.com"), registrableDomain("https://signature-landscape.com"));
  assert.equal(registrableDomain("not a url"), "");
  assert.equal(registrableDomain(""), "");
});

test("a capture that landed on another domain is refused; www/path drift is not a mismatch", () => {
  const expected = "https://flintplumb.com/";
  assert.equal(capturedShotBelongsTo({ capturedUrl: "https://www.flintplumb.com/services", expectedWebsite: expected }).ok, true);
  assert.equal(capturedShotBelongsTo({ capturedUrl: "http://flintplumb.com", expectedWebsite: expected }).ok, true);

  const parked = capturedShotBelongsTo({ capturedUrl: "https://parking.godaddy-domains.example/lander", expectedWebsite: expected });
  assert.equal(parked.ok, false);
  assert.equal(parked.reason, "capture_domain_mismatch");
  assert.equal(parked.expected, "flintplumb.com");
});

test("FAIL CLOSED: an unrecorded capture source is not evidence of a match", () => {
  const unrecorded = capturedShotBelongsTo({ capturedUrl: "", expectedWebsite: "https://flintplumb.com/" });
  assert.equal(unrecorded.ok, false);
  assert.equal(unrecorded.reason, "capture_source_unrecorded");

  const noSite = capturedShotBelongsTo({ capturedUrl: "https://flintplumb.com/", expectedWebsite: "" });
  assert.equal(noSite.ok, false);
  assert.equal(noSite.reason, "prospect_has_no_current_website");
});

// ---------------------------------------------------------------------------
// 2. Compose refuses — the email cannot be built around a stranger's screenshot
// ---------------------------------------------------------------------------

const READY_CTA = {
  previewUrl: "https://wss-test-flint.wss-ai.com/",
  currentUrl: "https://flintplumb.com/",
  currentWebsite: "https://flintplumb.com/",
  beforeImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=a&s=b&v=old",
  afterImage: "https://ghost.wss-ai.com/api/media/preview-shot?k=c&s=d&v=new",
};

test("proofReadiness attaches a before-image only when its captured page is the prospect's", () => {
  const good = proofReadiness({ cta: { ...READY_CTA, beforeImageSource: "https://www.flintplumb.com/" } });
  assert.equal(good.ok, true);
  assert.equal(good.beforeImageDomain, "flintplumb.com");

  const stranger = proofReadiness({ cta: { ...READY_CTA, beforeImageSource: "https://signature-landscape.example/" } });
  assert.equal(stranger.ok, false);
  assert.equal(stranger.reason, "before_image_capture_domain_mismatch");

  const unrecorded = proofReadiness({ cta: { ...READY_CTA, beforeImageSource: "" } });
  assert.equal(unrecorded.ok, false, "no recorded source must not pass — that is every pre-check shot");
  assert.equal(unrecorded.reason, "before_image_capture_source_unrecorded");
});

async function compose(extra) {
  process.env.EMAIL_UNSUB_SECRET = "test-secret";
  process.env.GHOST_AGENCY_POSTAL_ADDRESS = "123 Real St, Irvine, CA 92618";
  process.env.GHOST_AGENCY_SUPPORT_EMAIL = "support@example.test";
  const fingerprint = "flint-plumbing-composition-v1";
  const releaseEvidence = {
    schema: "siteforge-release-evidence-v1",
    map: {
      verified: true,
      qc_check: { name: "release-map-evidence", detail: "verified" },
      artifact: "screenshots/desktop/map.png",
      evidence_artifact: "screenshots/map-evidence.json",
      manifest_artifact: "screenshots/manifest.json",
      screenshot: { size: 4096, sha256: "c".repeat(64) },
      runtime: { response_ok: true, geometry_ok: true, pixels_ok: true, unique_colors: 32, variance: 120 },
      manifest: { schema: "siteforge-screenshot-manifest-v1", map_pass: true },
      supporting_checks: [
        { name: "visual-satellite-map-evidence", pass: true, detail: "verified" },
        { name: "visual-address-map-directions", pass: true, detail: "verified" },
      ],
      screenshot_url: "https://preview.wss-ai.com/try/FlintZ9/screenshots/desktop/map.png",
    },
    identity: {
      verified: true,
      qc_check: { name: "release-business-identity-match", detail: "matched" },
      expected: { business_name: "Flint Plumbing LLC" },
      actual: { business_name: "Flint Plumbing LLC", public_packet_business_name: "Flint Plumbing LLC", local_business_nodes: 1 },
      public_packet_url: "https://preview.wss-ai.com/try/FlintZ9/packet.json",
    },
    template_family: {
      verified: true,
      qc_check: { name: "release-template-family-match", detail: "matched" },
      expected: { family: "plumbing-pressure-lens" },
      actual: { family: "plumbing-pressure-lens" },
      public_packet_url: "https://preview.wss-ai.com/try/FlintZ9/packet.json",
    },
  };
  const { sendSequenceStep } = require("../lib/email");
  return sendSequenceStep({
    prospect: {
      prospect_id: "flint-1",
      business_name: "Flint Plumbing LLC",
      email: "owner@example.test",
      city: "Buda",
      industry: "plumbing",
      current_website: "https://flintplumb.com/",
      preview_url: "https://preview.wss-ai.com/try/FlintZ9/",
      siteforge_renderer: "05-build-v8",
      siteforge_generation_fingerprint: fingerprint,
      siteforge_qc_passed: true,
      siteforge_visual_qc_passed: true,
      siteforge_qc_contract: "public-surface-v2",
      release_evidence: releaseEvidence,
      truth_packet: { intakeGenie: { generation_fingerprint: fingerprint, release_evidence: releaseEvidence } },
      ...extra,
    },
    sequence: 1,
    step: 1,
    dryRun: true,
  });
}

test("the email refuses to send when the before-shot came from a different business's site", async () => {
  const wrong = await compose({ before_shot_source_url: "https://signature-landscape.example/home" });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.blocked, "before_image_capture_domain_mismatch");
  assert.match(wrong.message, /YOUR SITE TODAY/);
  assert.equal(wrong.htmlPreview, undefined, "nothing may be composed around a refused artifact");
});

test("the email refuses to send when nothing recorded where the before-shot came from", async () => {
  const unrecorded = await compose({});
  assert.equal(unrecorded.ok, false);
  assert.equal(unrecorded.blocked, "before_image_capture_source_unrecorded");
});

test("a before-shot recorded on the prospect's own domain composes and ships the image", async () => {
  const ok = await compose({ before_shot_source_url: "https://www.flintplumb.com/" });
  assert.equal(ok.ok, true, ok.blocked || "");
  assert.equal(ok.mode, "dry_run");
  assert.match(ok.htmlPreview, /\/api\/media\/preview-shot\?[^"']*v=old/, "the before image must actually be attached");
  assert.match(ok.htmlPreview, /\/api\/media\/preview-shot\?[^"']*v=new/);
});

// ---------------------------------------------------------------------------
// 3. The proxy enforces the same rule against the stored sidecar
// ---------------------------------------------------------------------------

function mkRes() {
  return {
    statusCode: 0, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    end(b) { this.body = b === undefined ? "" : b; },
  };
}

function qsFor(args) {
  const p = signedVisualPath(args);
  return Object.fromEntries(new URLSearchParams(p.split("?")[1]).entries());
}

/** Serve a JPEG for the image key and a chosen sidecar for the .json key. */
function storageStub({ capturedUrl }) {
  const jpeg = Buffer.alloc(4096, 7);
  return async (url) => {
    const isMeta = String(url).endsWith(".json");
    if (isMeta && capturedUrl === null) return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    const body = isMeta
      ? Buffer.from(JSON.stringify({ schema: "wss-proof-shot-meta-v1", variant: "old", captured_url: capturedUrl }), "utf8")
      : jpeg;
    return {
      ok: true,
      status: 200,
      headers: { get: () => (isMeta ? "application/json" : "image/jpeg") },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
}

test("the proxy serves a before-shot whose sidecar proves it is the prospect's own site", async () => {
  const handler = require("../api/media/preview-shot");
  const realFetch = global.fetch;
  global.fetch = storageStub({ capturedUrl: "https://www.flintplumb.com/" });
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "old", previewUrl: "https://m.wss-ai.com/", currentWebsite: "https://flintplumb.com/", nonce: "p1" }) }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Content-Type"], "image/jpeg");
    assert.equal(res.body.length, 4096);
  } finally {
    global.fetch = realFetch;
  }
});

test("the proxy refuses a before-shot captured from somebody else's domain", async () => {
  const handler = require("../api/media/preview-shot");
  const realFetch = global.fetch;
  global.fetch = storageStub({ capturedUrl: "https://signature-landscape.example/" });
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "old", previewUrl: "https://m.wss-ai.com/", currentWebsite: "https://mismatch-target.example/", nonce: "p2" }) }, res);
    assert.equal(res.statusCode, 200, "an image route answers with a pixel, never a 500");
    assert.equal(res.headers["Content-Type"], "image/gif");
    assert.equal(res.body.length, SPACER_GIF.length);
    assert.match(res.headers["X-Proof-Shot"], /before_shot_capture_domain_mismatch/);
  } finally {
    global.fetch = realFetch;
  }
});

test("the proxy refuses a before-shot with no sidecar at all", async () => {
  const handler = require("../api/media/preview-shot");
  const realFetch = global.fetch;
  global.fetch = storageStub({ capturedUrl: null });
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "old", previewUrl: "https://m.wss-ai.com/", currentWebsite: "https://unrecorded.example/", nonce: "p3" }) }, res);
    assert.equal(res.headers["Content-Type"], "image/gif");
    assert.match(res.headers["X-Proof-Shot"], /before_shot_capture_source_unrecorded/);
  } finally {
    global.fetch = realFetch;
  }
});

test("the 'new' variant is unaffected — it is a picture of our own mirror", async () => {
  const handler = require("../api/media/preview-shot");
  const realFetch = global.fetch;
  let metaFetches = 0;
  global.fetch = async (url) => {
    if (String(url).endsWith(".json")) metaFetches += 1;
    const jpeg = Buffer.alloc(2048, 3);
    return { ok: true, status: 200, headers: { get: () => "image/jpeg" }, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength) };
  };
  try {
    const res = mkRes();
    await handler({ method: "GET", query: qsFor({ kind: "new", previewUrl: "https://fresh-mirror.wss-ai.com/", currentWebsite: "https://flintplumb.com/", nonce: "p4" }) }, res);
    assert.equal(res.headers["Content-Type"], "image/jpeg");
    assert.equal(metaFetches, 0, "the new-shot path must not pay for a sidecar read");
  } finally {
    global.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// 4. The writer records the source, and refuses to store a drifted capture
// ---------------------------------------------------------------------------

test("the sidecar shares the image's content-addressed key", () => {
  const jpg = proofObjectPath({ url: "https://flintplumb.com/", variant: "old" });
  const meta = proofMetaPath({ url: "https://flintplumb.com/", variant: "old" });
  assert.match(jpg, /^preview-shots\/old\/[0-9a-f]{64}\.jpg$/);
  assert.equal(meta, jpg.replace(/\.jpg$/, ".json"));
  assert.equal(proofMetaPath({ url: "not a url", variant: "old" }), "");
});

test("the capture pipeline carries the landing URL out of the browser", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "preview-visuals.js"), "utf8");
  assert.match(src, /captureJpeg\.lastFinalUrl\s*=\s*String\(page\.url\(\)/, "the capture must record where it landed");
  assert.match(src, /out\.oldFinalUrl/, "the before-shot's landing URL must leave generatePreviewVisuals");

  const writer = fs.readFileSync(path.join(__dirname, "..", "scripts", "capture-proof-shots.js"), "utf8");
  assert.match(writer, /capturedShotBelongsTo/, "the writer must refuse to store a drifted before-shot");
  assert.match(writer, /proofMetaPath/, "the writer must store the sidecar beside the image");
  assert.match(writer, /captured_url/);
});
