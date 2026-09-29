"use strict";

// test/line-proof-shots-video-hero.test.js
//
// THE 2026-09-02 CAPTURE BUG, PINNED: a hero-video mirror cost its own AFTER
// shot. Landscaping donors ship 2–3MB hero MP4s; the AFTER capture waited for
// networkidle, the clip kept the network busy past every timeout, and the
// fallback RE-navigated with waitUntil "load" — which Chrome delays until the
// media's metadata arrives, i.e. after the whole non-web-optimized file. Both
// attempts blew the budget the same deterministic way, so gate_passed rows
// with LIVE mirrors died on capture_incomplete:no_after_shot (batch
// line_mtkw4rlq_c830312fdd: Gras Lawn, Landscape Improvements). The BEFORE
// shot of the prospect's own site never had the problem.
//
// The fix these tests hold:
//   · the AFTER (mirror) capture ABORTS video/audio requests at the network
//     layer — the donor hero paints its own poster/colour under the video and
//     the walker hides a clip whose source errored, so the shot is designed to
//     look right without the clip — and waits for domcontentloaded + paint,
//     never network quiet;
//   · if even that bounded wait outruns the budget slice, the shutter fires
//     anyway on what painted and the report names capture_wait_degraded
//     instead of returning no_after_shot;
//   · the BEFORE capture keeps the strategy that is honest about a
//     stranger's page (networkidle → load, no interception, no emulation);
//     since 2026-09-03 it also runs the SAME first-paint gate ahead of its
//     1200ms settle — the gray/blank before-shot fix — bounded and fail-open.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const { proofMetaPath } = require("../lib/proof-storage");
const { ensureLineProofShots } = require("../lib/line-proof-shots");

const MIRROR = "https://wss-test-gras-lawn-lakewood.wss-ai.com/";
const THEIR_SITE = "https://graslawn.example/";

// ---------------------------------------------------------------------------
// A fake bucket, so the whole capture runs with no network (same shape as the
// line-email-assets suite's fake).
// ---------------------------------------------------------------------------
function fakeBucket() {
  const objects = new Map();
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if ((options.method || "GET").toUpperCase() === "POST") {
      const key = target.split("/object/")[1] || target;
      objects.set(key, Buffer.from(options.body));
      return { ok: true, status: 200, text: async () => "", headers: new Map() };
    }
    const key = target.split(`/public/wss-proof-assets/`)[1] || "";
    const hit = objects.get(`wss-proof-assets/${key}`) || objects.get(key);
    if (!hit) return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : "") },
      arrayBuffer: async () => hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength),
    };
  };
  return { objects, restore() { global.fetch = realFetch; } };
}

// ---------------------------------------------------------------------------
// A browser-shaped stub that reproduces the live failure's mechanics:
//
//   · every MIRROR navigation also requests a document, a hero poster image
//     and a hero clip (mp4 + webm rung) — and while a clip request is live,
//     waitUntil networkidle AND load can never settle, exactly like a
//     streaming 2–3MB MP4 on the real site;
//   · a page whose clip requests are ABORTED by a route handler settles at
//     domcontentloaded, which is the fixed behaviour;
//   · the prospect's own site ("before") settles on its own load events and
//     must never be given a media policy.
// ---------------------------------------------------------------------------
function videoHeroBrowser({
  mirrorNavigationSettles = true,
  mirrorPaintSettles = true,
  beforeNetworkIdleSettles = true,
} = {}) {
  const state = { pages: [], browserCloses: 0 };
  const makePage = () => {
    const page = {
      role: null,
      routePattern: null,
      routeHandler: null,
      emulateMediaCalls: [],
      gotos: [],
      aborted: [],
      continued: [],
      waitForFunctionCalls: [],
      evaluateCalls: 0,
      waits: [],
      shots: [],
      current: "",
      async route(pattern, handler) { this.routePattern = pattern; this.routeHandler = handler; },
      async emulateMedia(options) { this.emulateMediaCalls.push(options); },
      async goto(url, options = {}) {
        const waitUntil = String(options.waitUntil || "load");
        if (!this.role) this.role = /wss-ai\.com/.test(url) ? "mirror" : "before";
        this.gotos.push({ url, waitUntil });
        this.current = url;
        if (this.role !== "mirror") {
          if (!beforeNetworkIdleSettles && waitUntil === "networkidle") {
            throw new Error(`Timeout ${options.timeout}ms exceeded waiting for "${waitUntil}"`);
          }
          return { status: () => 200 };
        }
        const subresources = [
          { url, resourceType: "document" },
          { url: "https://mirror-assets.test/hero-poster.jpg", resourceType: "image" },
          { url: "https://mirror-assets.test/hero-clip.mp4?ver=9", resourceType: "media" },
          { url: "https://mirror-assets.test/hero-clip.webm", resourceType: "media" },
          { url: "https://mirror-assets.test/ambient.m4a", resourceType: "other" },
        ];
        const liveMedia = [];
        for (const sub of subresources) {
          let aborted = false;
          if (this.routeHandler) {
            await this.routeHandler({
              request: () => ({ url: () => sub.url, resourceType: () => sub.resourceType }),
              abort: async () => { aborted = true; this.aborted.push(sub.url); },
              continue: async () => { this.continued.push(sub.url); },
            });
          }
          if (!aborted && sub.resourceType === "media") liveMedia.push(sub.url);
        }
        // A streaming clip keeps the network busy forever: this is the exact
        // condition that made networkidle (and Chrome's media-delayed load)
        // blow both attempts on the live sites.
        if (liveMedia.length && (waitUntil === "networkidle" || waitUntil === "load")) {
          throw new Error(`Timeout ${options.timeout}ms exceeded waiting for "${waitUntil}"`);
        }
        if (!mirrorNavigationSettles && waitUntil === "domcontentloaded") {
          throw new Error(`Timeout ${options.timeout}ms exceeded`);
        }
        return { status: () => 200 };
      },
      async waitForFunction(fn, arg, options) { this.waitForFunctionCalls.push(options); if (!mirrorPaintSettles) throw new Error("Timeout waiting for paint"); },
      async evaluate() { this.evaluateCalls += 1; },
      async waitForTimeout(ms) { this.waits.push(ms); },
      async screenshot(shotOptions) {
        this.shots.push({
          ...shotOptions,
          landed: this.current,
          clipAborted: this.aborted.filter((u) => /\.(?:mp4|webm|m4a)(?:[?]|$)/i.test(u)),
          posterLoaded: this.continued.some((u) => /hero-poster\.jpg/.test(u)),
        });
        return Buffer.from(`jpeg-bytes-for-${this.current}`);
      },
      async close() {},
      url() { return this.current; },
    };
    return page;
  };
  return {
    state,
    async newPage() { const page = makePage(); state.pages.push(page); return page; },
    async close() { state.browserCloses += 1; },
  };
}

function mirrorPages(browser) { return browser.state.pages.filter((page) => page.role === "mirror"); }
function beforePages(browser) { return browser.state.pages.filter((page) => page.role === "before"); }

// ---------------------------------------------------------------------------
// 1. THE AFTER SHOT COMPLETES ON A VIDEO-HERO MIRROR
// ---------------------------------------------------------------------------

test("a mirror whose hero clip never stops streaming still gets its AFTER shot — media aborted, poster painted", async () => {
  const bucket = fakeBucket();
  const browser = videoHeroBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-video-hero",
      browser,
    });

    // THE REPAIR'S WHOLE POINT: the pair completed. Under the old strategy the
    // mirror goto below would have thrown on networkidle (the fake encodes the
    // live streaming-clip condition) and this was no_after_shot.
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.match(out.shots.new_captured_url, /^https:\/\/wss-test-gras-lawn-lakewood\.wss-ai\.com\/\?wssthumb=1$/);
    assert.match(out.shots.new_mobile_captured_url, /wssthumb=1/);

    const mirrors = mirrorPages(browser);
    assert.equal(mirrors.length, 2, "new + new-mobile");
    for (const page of mirrors) {
      // WAIT STRATEGY: one navigation, domcontentloaded — never networkidle,
      // never the media-delayed load.
      assert.equal(page.gotos.length, 1, "the mirror is navigated exactly once");
      assert.ok(page.gotos.every((g) => g.waitUntil === "domcontentloaded"), JSON.stringify(page.gotos));
      assert.match(page.gotos[0].url, /wssthumb=1/, "our panels stay suppressed on the mirror");

      // MEDIA POLICY: interception was installed before the navigation, the
      // clip rungs (and the extension-shaped audio) were aborted, and the
      // poster image — the paint the shot must show — was allowed through.
      assert.equal(page.routePattern, "**/*");
      assert.ok(page.aborted.includes("https://mirror-assets.test/hero-clip.mp4?ver=9"));
      assert.ok(page.aborted.includes("https://mirror-assets.test/hero-clip.webm"));
      assert.ok(page.aborted.includes("https://mirror-assets.test/ambient.m4a"));
      assert.equal(page.emulateMediaCalls.length, 1);
      assert.equal(page.emulateMediaCalls[0].reducedMotion, "reduce");

      // THE SHOT ITSELF: taken on the mirror, clip aborted at shutter time,
      // poster loaded.
      assert.equal(page.shots.length, 1);
      assert.ok(page.shots[0].posterLoaded, "the hero's poster/paint-under is what the shutter saw");
      assert.ok(page.shots[0].clipAborted.length >= 2);
      assert.doesNotMatch(page.shots[0].landed, /about:blank/);
    }

    // A COMPLETED CAPTURE IS NOT A DEGRADED ONE: no capture_wait_degraded
    // anywhere on the happy path.
    assert.ok(out.results.every((r) => !r.capture_wait_degraded), JSON.stringify(out.results));
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. THE BEFORE SHOT IS UNTOUCHED
// ---------------------------------------------------------------------------

test("the prospect's own site keeps its honest strategy: networkidle, load fallback, and no media policy — plus the paint gate", async () => {
  const bucket = fakeBucket();
  // Their site has a slow beacon: networkidle times out, load succeeds — the
  // historical fallback path, still taken, still sufficient.
  const browser = videoHeroBrowser({ beforeNetworkIdleSettles: false });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-before-unchanged",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(out.shots.old_captured_url, THEIR_SITE);

    const befores = beforePages(browser);
    assert.equal(befores.length, 2, "old + old-mobile");
    for (const page of befores) {
      assert.deepEqual(page.gotos.map((g) => g.waitUntil), ["networkidle", "load"],
        "a stranger's page: only its own load events speak for it, fallback intact");
      assert.equal(page.routePattern, null, "no request interception is ever installed on their site");
      assert.equal(page.emulateMediaCalls.length, 0, "no emulation is ever applied to their site");
      assert.deepEqual(page.waits, [1200], "the before settle is unchanged");
      // THE FIRST-PAINT GATE (2026-09-03): the before lane now runs the same
      // eager-images + two-frame paint check the mirror lane uses, ahead of
      // that settle — the gray/blank phone-shot fix. The wait is bounded.
      assert.ok(page.waitForFunctionCalls.length >= 1, "the paint gate did not run on the before lane");
      assert.ok(page.waitForFunctionCalls.every((o) => Number(o && o.timeout) >= 1000),
        "the before paint wait must be bounded, never unbounded");
      assert.ok(page.evaluateCalls >= 1, "the two-frame paint settle did not run on the before lane");
    }
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. THE BUDGET GUARD — a degraded shot with a named field beats no_after_shot
// ---------------------------------------------------------------------------

test("a mirror navigation that outruns its budget slice is still shot, and the report names capture_wait_degraded", async () => {
  const bucket = fakeBucket();
  // domcontentloaded itself times out: the origin is slower than the whole
  // budget slice. The page DID commit (url() is the mirror), paint is unknown.
  const browser = videoHeroBrowser({ mirrorNavigationSettles: false });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-slow-origin",
      browser,
    });

    // THE PAIR STILL COMPLETED — the shot exists, passed identity, and is
    // stored; the degradation is NAMED, not silent, and not fatal.
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.match(out.shots.new_captured_url, /wssthumb=1/);
    const degraded = out.results.filter((r) => /^new/.test(r.variant) && r.ok);
    assert.ok(degraded.every((r) => r.capture_wait_degraded === "navigation_timeout"), JSON.stringify(out.results));
    assert.equal(mirrorPages(browser).every((page) => page.shots.length === 1), true,
      "the shutter fired anyway on what had painted");

    // The stored sidecar carries the same named degradation, so a later
    // reader can tell a settled shot from a budget-degraded one.
    const metaRaw = bucket.objects.get(`wss-proof-assets/${proofMetaPath({ url: MIRROR, variant: "new" })}`)
      || bucket.objects.get(proofMetaPath({ url: MIRROR, variant: "new" }));
    assert.ok(metaRaw, "the v2 sidecar was written");
    const meta = JSON.parse(metaRaw.toString("utf8"));
    assert.equal(meta.capture_wait_degraded, "navigation_timeout");
    assert.match(meta.captured_url, /wssthumb=1/);
  } finally {
    bucket.restore();
  }
});

test("a mirror whose paint never settles within the budget is shot with every gate's miss named", async () => {
  const bucket = fakeBucket();
  // Navigation settles, but eager images hang past the paint wait — and since
  // the hero gate (2026-09-03) runs after the first-paint gate, a stub that
  // throws on every waitForFunction starves BOTH: the composed miss names
  // each gate that outran its budget, joined with the lane's convention.
  const browser = videoHeroBrowser({ mirrorPaintSettles: false });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-slow-paint",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.match(out.shots.new_captured_url, /wssthumb=1/);
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.capture_wait_degraded, "paint_wait_timeout+mirror_paint_timeout");
    assert.equal(mirrorPages(browser).every((page) => page.shots.length === 1), true);
  } finally {
    bucket.restore();
  }
});

test("a degraded navigation to nowhere is still refused on identity — degradation never overrides the fail-closed checks", async () => {
  const bucket = fakeBucket();
  // The mirror never commits: page.url() stays about:blank when the goto dies.
  const browser = videoHeroBrowser({ mirrorNavigationSettles: false });
  const realNewPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await realNewPage();
    page.url = () => "about:blank";
    return page;
  };
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-blank",
      browser,
    });
    // The degradation law is "shoot what painted", not "store anything": a
    // shot that landed nowhere is refused exactly as before.
    assert.equal(out.ok, false);
    assert.match(out.reason, /no_after_shot/);
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.ok, false);
    assert.match(after.reason, /^capture_identity_preview_host_not_approved$/);
  } finally {
    bucket.restore();
  }
});
