"use strict";

// test/line-proof-shots-mirror-fixture.test.js — THE LIVE-SHAPED FIXTURE.
//
// The no_after_shot rows were never reproducible in CI because every proof-shot
// test drove the capture with injected page fakes; the real chromium path (the
// launcher, route interception, real paints, a real MP4 trickling forever) was
// exercised nowhere. This suite runs the REAL captureOne — real chromium via
// lib/serverless-chromium, real HTTP — against the exact Gras Lawn shape that
// killed the live batches:
//
//   · a hero <video autoplay> whose clip is an ENDLESS 3MB trickle (networkidle
//     and Chrome's media-delayed load can never settle on it),
//   · eager images that must settle before the shutter,
//   · a below-fold lazy image that must not block the paint gate,
//   · an analytics beacon that hangs forever,
//   · the site-router's x-wss-* identity headers on the document.
//
// The preview-host guard is widened to approve the loopback fixture host (and
// only it) BEFORE lib/line-proof-shots is loaded, so the production host allow-
// list itself is untouched. Skipped automatically where no chromium is
// installed (e.g. a CI image without browser downloads) so the suite stays
// green everywhere the injected-fake suites already run.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

// ---------------------------------------------------------------------------
// THE HOST-GUARD WIDENING — must precede the line-proof-shots require, which
// binds isApprovedPreviewUrl/previewHostOf at load time.
// ---------------------------------------------------------------------------
const GUARD_PATH = require.resolve("../lib/preview-host-guard");
const realGuard = require(GUARD_PATH);
const LOOPBACK_HOST_RE = /^https?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?/i;
require.cache[GUARD_PATH].exports = {
  ...realGuard,
  isApprovedPreviewUrl: (url) => (
    LOOPBACK_HOST_RE.test(String(url || "")) || realGuard.isApprovedPreviewUrl(url)
  ),
  previewHostOf: (url) => {
    const match = LOOPBACK_HOST_RE.exec(String(url || ""));
    return match ? match[1] : realGuard.previewHostOf(url);
  },
};

const { ensureLineProofShots, measureShotUniformity, SHOT_BLANK_STD_MIN } = require("../lib/line-proof-shots");
const { launchChromium } = require("../lib/serverless-chromium");

const SHARED_IDENTITY = Object.freeze({
  site_id: "site_01fixture",
  release_id: "release_fixture",
  build_hash: "a".repeat(64),
});

const PAGE_HTML = (title) => `<!doctype html><html><head><title>${title}</title></head>
<body style="margin:0;font-family:sans-serif">
  <video id="hero" autoplay muted loop playsinline
    poster="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='90'%3E%3Crect width='160' height='90' fill='%233a5f2a'/%3E%3Ctext x='50%25' y='55%25' fill='white' font-size='10' text-anchor='middle'%3EGRAS LAWN%3C/text%3E%3C/svg%3E"
    style="position:fixed;inset:0;width:100vw;height:100vh;object-fit:cover">
    <source src="/hero.mp4" type="video/mp4">
  </video>
  <header style="position:relative;background:#fff;padding:12px">
    <img src="/logo.png" width="120" height="30" alt="logo">
  </header>
  <main style="position:relative;padding:24px;color:#fff">
    <h1>Lakewood's Lawn Care</h1>
    <img src="/photo1.jpg" width="400" height="225" alt="lawn">
    <img loading="lazy" src="/photo2.jpg" width="400" height="225" alt="yard">
  </main>
  <script>fetch('/analytics-beacon?r=' + Math.random()).catch(function(){});</script>
</body></html>`;

// The fixture: identity headers on every response like the site-router, a
// never-ending media trickle, and hung analytics like a stalling beacon.
function startFixture() {
  const seen = { eagerImageRequests: 0, mediaRequests: 0, mediaClosedEarly: 0, documentRequests: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("x-wss-site-id", SHARED_IDENTITY.site_id);
    res.setHeader("x-wss-release-id", SHARED_IDENTITY.release_id);
    res.setHeader("x-wss-build-hash", SHARED_IDENTITY.build_hash);
    res.setHeader("x-wss-route-generation", "7");
    if (url.pathname === "/") {
      seen.documentRequests += 1;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(PAGE_HTML("Gras Lawn Fixture"));
      return;
    }
    if (url.pathname === "/hero.mp4") {
      seen.mediaRequests += 1;
      // A clip that NEVER finishes: endless 4KB ticks against a 3MB body —
      // exactly the non-web-optimized donor hero that pinned networkidle.
      res.setHeader("content-type", "video/mp4");
      res.setHeader("content-length", "3000000");
      res.flushHeaders();
      const trickle = setInterval(() => {
        if (res.writableEnded) return;
        res.write(Buffer.alloc(4096, 1));
      }, 40);
      res.on("close", () => {
        clearInterval(trickle);
        if (!res.writableEnded) seen.mediaClosedEarly += 1;
      });
      return;
    }
    if (url.pathname === "/analytics-beacon") {
      return; // hangs forever, like a stalling third-party collector
    }
    if (url.pathname === "/photo1.jpg" || url.pathname === "/logo.png") {
      seen.eagerImageRequests += 1;
    }
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    res.setHeader("content-type", /photo/.test(url.pathname) ? "image/jpeg" : "image/png");
    res.end(png);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/`,
        seen,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

async function chromiumAvailable() {
  try {
    const browser = await launchChromium();
    await browser.close().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

test("the live-shaped mirror fixture (endless hero clip, lazy images, hung beacon) completes its AFTER shot on real chromium", { timeout: 120_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const fixture = await startFixture();
  const stored = new Map();
  let browser;
  try {
    browser = await launchChromium();
    const startedAt = Date.now();
    const out = await ensureLineProofShots({
      currentWebsite: "",
      previewUrl: fixture.baseUrl,
      buildHash: "build-fixture-live",
      browser,
      readProofShot: async () => ({ ok: false, status: 404, reason: "storage_404" }),
      writeProofShot: async (objectPath, buffer) => {
        stored.set(objectPath, Buffer.from(buffer));
        return { ok: true, bytes: buffer.length };
      },
    });
    const elapsedMs = Date.now() - startedAt;

    // THE PIN: both AFTER variants complete, in seconds, on a page whose clip
    // never stops streaming. This exact shape was a deterministic
    // no_after_shot on the live batches.
    const newVariants = out.results.filter((r) => /^new(?:-|$)/.test(String(r.variant)));
    assert.equal(newVariants.length, 2, JSON.stringify(out.results));
    for (const entry of newVariants) {
      assert.equal(entry.ok, true, JSON.stringify({ entry, results: out.results }));
      assert.match(entry.publicUrl, /\.jpg$/);
    }
    assert.match(out.reason, /no_current_website/, "the only miss is the intentionally-absent before side");
    assert.ok(elapsedMs < 30_000, `capture must not wait on the endless clip (took ${elapsedMs}ms)`);

    // REAL pixels: a stored JPEG of the painted poster, not a blank frame.
    const jpgs = [...stored.entries()].filter(([k]) => /\.jpg$/.test(k) && /\/new/.test(k));
    assert.equal(jpgs.length, 2);
    for (const [key, buffer] of jpgs) {
      assert.ok(buffer.length > 4_096, `${key} is ${buffer.length} bytes — a blank frame is far smaller`);
      assert.equal(buffer[0], 0xff, "jpeg magic");
      assert.equal(buffer[1], 0xd8, "jpeg magic");
    }

    // The sidecars are complete, hash-keyed records.
    for (const [key, buffer] of stored) {
      if (!/\.json$/.test(key)) continue;
      const meta = JSON.parse(buffer.toString("utf8"));
      assert.match(meta.shot_sha256, /^[0-9a-f]{64}$/);
      assert.match(meta.captured_url, /wssthumb=1/, "the panel-suppression flag rode the navigation");
      assert.equal(meta.bytes > 4_096, true);
    }

    // The page itself was served and its eager images settled.
    assert.ok(fixture.seen.documentRequests >= 2, "both variants loaded the document");
    assert.ok(fixture.seen.eagerImageRequests >= 2, "eager images were fetched before the shutter");
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fixture.close();
  }
});

test("the fixture's shared identity headers satisfy the real response-identity check end to end", { timeout: 120_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const fixture = await startFixture();
  const stored = new Map();
  let browser;
  try {
    browser = await launchChromium();
    const out = await ensureLineProofShots({
      currentWebsite: "",
      previewUrl: fixture.baseUrl,
      buildHash: SHARED_IDENTITY.build_hash,
      proofIdentity: SHARED_IDENTITY,
      browser,
      readProofShot: async () => ({ ok: false, status: 404, reason: "storage_404" }),
      writeProofShot: async (objectPath, buffer) => {
        stored.set(objectPath, Buffer.from(buffer));
        return { ok: true, bytes: buffer.length };
      },
    });
    const newVariants = out.results.filter((r) => /^new(?:-|$)/.test(String(r.variant)));
    for (const entry of newVariants) {
      assert.equal(entry.ok, true, JSON.stringify({ entry, results: out.results }));
      assert.equal(entry.response_identity_via, "main_document_response");
    }
    // The v3 sidecars carry the exact shared tuple.
    for (const [key, buffer] of stored) {
      if (!/\.json$/.test(key)) continue;
      const meta = JSON.parse(buffer.toString("utf8"));
      assert.equal(meta.schema, "wss-proof-shot-meta-v3");
      assert.equal(meta.site_id, SHARED_IDENTITY.site_id);
      assert.equal(meta.release_id, SHARED_IDENTITY.release_id);
      assert.equal(meta.build_hash, SHARED_IDENTITY.build_hash);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fixture.close();
  }
});

// ---------------------------------------------------------------------------
// THE SHOT-CRAFT GUARDS ON REAL CHROMIUM (2026-09-05, audit A4) — the donors
// whose delivered shots were "an honest capture of the hero's empty top
// sliver", reproduced as fixtures and pinned at PIXEL level with the audit's
// own measurement method.
// ---------------------------------------------------------------------------

// A donor whose hero CONTENT starts far below the fold behind a flat top slab
// (Superior Fence: h1 at y=1239 phone / y=2081 desktop, captured as "header +
// empty hero top"), with a text-bearing header so chrome paint alone settles
// fast — the exact shape that slipped past both paint gates.
const BELOW_FOLD_HTML = `<!doctype html><html><head><title>Slab Fixture</title></head>
<body style="margin:0;font-family:sans-serif">
  <header style="height:64px;background:#101318;color:#EDEDF2;display:flex;align-items:center;padding:0 16px;font-weight:700">SUPERIOR FENCE &amp; RAIL</header>
  <div style="height:2000px;background:#15181d"></div>
  <main style="padding:32px 24px;background:#f4f0e6;color:#1c1c1c">
    <h1 style="font-size:56px;line-height:1.05;margin:0 0 20px">Middle Tennessee's fence company</h1>
    <p style="font-size:20px;max-width:640px;margin:0 0 24px">Fences built to last, priced to fit. Free estimates across the region, installed by crews that show up when they say they will.</p>
    <div style="height:220px;background:repeating-linear-gradient(45deg,#b3402a 0 8px,#2a5fb3 8px 16px)"></div>
    <div style="height:220px;background:repeating-linear-gradient(-45deg,#f2f2f2 0 6px,#222222 6px 12px)"></div>
    <div style="height:220px;background:repeating-linear-gradient(90deg,#2ab35f 0 10px,#e8c547 10px 20px)"></div>
  </main>
</body></html>`;

// The Hage shape: an EAGER hero poster SVG with real intrinsic width, laid
// out at 0x0 — "complete && naturalWidth > 0" certified it for months while
// the phone hero rendered nothing at all.
const ZERO_ART_HTML = `<!doctype html><html><head><title>Zero Fixture</title></head>
<body style="margin:0;font-family:sans-serif;background:#ffffff">
  <img src="/hero-poster.svg" alt="" style="width:0;height:0;border:0">
  <main style="padding:32px 24px">
    <h1 style="font-size:40px;margin:0 0 16px;color:#111111">Visible typographic hero</h1>
    <p style="font-size:18px;color:#333333">Real content, painted and in frame - just no art surface for the hero gate to certify.</p>
  </main>
</body></html>`;

function startShapeFixture(html, { serveSvg = false } = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("x-wss-site-id", SHARED_IDENTITY.site_id);
    res.setHeader("x-wss-release-id", SHARED_IDENTITY.release_id);
    res.setHeader("x-wss-build-hash", SHARED_IDENTITY.build_hash);
    if (serveSvg && url.pathname === "/hero-poster.svg") {
      res.setHeader("content-type", "image/svg+xml");
      res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#23301f"/></svg>`);
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

test("a mirror whose hero content starts below the fold is FRAMED on the content - real pixels prove it", { timeout: 120_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const fixture = await startShapeFixture(BELOW_FOLD_HTML);
  const stored = new Map();
  let browser;
  try {
    browser = await launchChromium();
    const NOW = Date.now();
    const out = await ensureLineProofShots({
      currentWebsite: "",
      previewUrl: fixture.baseUrl,
      buildHash: "build-below-fold",
      browser,
      deadlineAt: NOW + 30_000,
      now: () => NOW,
      readProofShot: async () => ({ ok: false, status: 404, reason: "storage_404" }),
      writeProofShot: async (objectPath, buffer) => {
        stored.set(objectPath, Buffer.from(buffer));
        return { ok: true, bytes: buffer.length };
      },
    });

    const newResults = out.results.filter((r) => /^new/.test(String(r.variant)));
    assert.equal(newResults.length, 2, JSON.stringify(out.results));
    for (const entry of newResults) {
      assert.equal(entry.ok, true, JSON.stringify(entry));
      // THE FRAME MOVED TO THE CONTENT (audit A4 defect A): the capture
      // scrolled to the hero h1 instead of photographing the empty slab.
      assert.equal(entry.capture_framed_via, "hero:h1",
        `the ${entry.variant} shot was not framed on the hero content`);
      // THE GATE STAYED HONEST: no in-viewport hero art existed before the
      // scroll, so the hero surface refused to certify - named, not silent.
      assert.match(String(entry.capture_wait_degraded || ""), /mirror_paint_timeout/,
        "an out-of-frame hero must not certify the hero gate");
    }

    // REAL PIXELS, THE AUDIT'S OWN METER: the stored shots read as content in
    // the healthy band - before the framing fix these measured as slabs.
    const meter = await browser.newPage();
    try {
      for (const variant of ["new", "new-mobile"]) {
        const key = [...stored.keys()].find((k) => k.startsWith(`preview-shots/${variant}/`) && k.endsWith(".jpg"));
        const shot = stored.get(key);
        assert.ok(shot, `the ${variant} shot was stored`);
        const stats = await measureShotUniformity(meter, shot);
        assert.ok(stats, "the pixel meter ran on the stored shot");
        assert.ok(stats.std >= SHOT_BLANK_STD_MIN,
          `${variant} luminance std ${stats.std} - the frame shows content, not the empty top slab`);
        assert.ok(stats.flatPct < 62, `${variant} flat ${stats.flatPct}% - near-uniform would be the slab again`);
      }
    } finally {
      await meter.close().catch(() => {});
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fixture.close();
  }
});

test("a 0x0-laid-out hero poster never certifies the hero gate - the miss is named and the shot still ships", { timeout: 120_000 }, async (t) => {
  if (!(await chromiumAvailable())) return t.skip("chromium is not installed in this environment");
  const fixture = await startShapeFixture(ZERO_ART_HTML, { serveSvg: true });
  const stored = new Map();
  let browser;
  try {
    browser = await launchChromium();
    const NOW = Date.now();
    const out = await ensureLineProofShots({
      currentWebsite: "",
      previewUrl: fixture.baseUrl,
      buildHash: "build-zero-art",
      browser,
      deadlineAt: NOW + 24_000,
      now: () => NOW,
      readProofShot: async () => ({ ok: false, status: 404, reason: "storage_404" }),
      writeProofShot: async (objectPath, buffer) => {
        stored.set(objectPath, Buffer.from(buffer));
        return { ok: true, bytes: buffer.length };
      },
    });

    const newResults = out.results.filter((r) => /^new/.test(String(r.variant)));
    assert.equal(newResults.length, 2, JSON.stringify(out.results));
    for (const entry of newResults) {
      assert.equal(entry.ok, true, JSON.stringify(entry));
      // THE ROOT CAUSE PINNED (defect A / gate predicates): complete &&
      // naturalWidth > 0 on a 0x0 image used to open the hero gate. It must
      // not anymore - and the refusal is NAMED, never a refused shot.
      assert.match(String(entry.capture_wait_degraded || ""), /mirror_paint_timeout/,
        "a 0x0 poster must not certify the hero surface");
      // The h1 is already in frame here, so no reframe is recorded.
      assert.equal(entry.capture_framed_via, undefined);
    }
    // Fail-open held: both shots stored as real JPEGs.
    const jpgs = [...stored.entries()].filter(([k]) => k.endsWith(".jpg"));
    assert.equal(jpgs.length, 2);
    for (const [, buffer] of jpgs) {
      assert.equal(buffer[0], 0xff);
      assert.equal(buffer[1], 0xd8);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await fixture.close();
  }
});
