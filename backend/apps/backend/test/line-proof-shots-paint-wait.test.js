"use strict";

// test/line-proof-shots-paint-wait.test.js
//
// THE GRAY/BLANK BEFORE SHOTS, PINNED (2026-09-03). Phone/before proof shots
// arrived in emails as gray or blank frames: the BEFORE lane's only paint
// strategy was a FIXED 1200ms settle on the far side of its navigation, and a
// JS-rendered site (Wix, Squarespace, GoDaddy Builder — the normal SMB stack)
// that paints after "load" was photographed mid-blank. The mirror ("new")
// lane already ran a first-paint gate — eager images settled, then two
// animation frames — and this suite holds that the SAME gate now bounds the
// BEFORE lane too:
//
//   · the shutter fires only AFTER the paint gate and the settle, in that
//     order, on every before variant — desktop AND phone (old-mobile);
//   · the wait is bounded by the variant's slice (never unbounded, never 0);
//   · the before lane keeps its honest-stranger strategy: networkidle → load
//     fallback, no request interception, no emulation;
//   · a stranger's page that never settles is still SHOT (the gate may only
//     wait, never refuse) and the miss is NAMED on the result and the sidecar
//     as capture_wait_degraded:paint_wait_timeout.
//
// THE MIRROR'S OWN GRAY PHONE SHOT, PINNED TOO (2026-09-03, later the same
// day — owner-verified in the delivered V3 email). The NEW-site phone shot
// rendered gray/blank while the old-site shot beside it was fine: on our
// mirror, first paint fires on CHROME paint — a client-rendered phone
// viewport can carry an EMPTY eager-image list at domcontentloaded, so the
// shared gate opens before the hero video's poster and the hydrated content
// have painted. The mirror lane now runs a SECOND gate after the first, the
// HERO SURFACE (a hero video frame decoded — readyState >= 2 — or the
// poster/paint-under image decoded with real pixels — complete &&
// naturalWidth > 0), and this suite holds:
//
//   · the mirror shutter fires only AFTER first paint → hero surface →
//     settle, in that order, on new AND new-mobile;
//   · the hero wait is bounded by the variant's slice (never unbounded,
//     never 0);
//   · a hero that never confirms is still SHOT (fail-open) after a bounded
//     extra settle, with the miss NAMED on the result and the sidecar as
//     capture_wait_degraded:mirror_paint_timeout.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const { proofMetaPath, proofObjectPath } = require("../lib/proof-storage");
const { ensureLineProofShots } = require("../lib/line-proof-shots");

const MIRROR = "https://wss-test-gras-lawn-lakewood.wss-ai.com/";
const THEIR_SITE = "https://graslawn.example/";
const REAL_HOUSE_HTML = "<html><body><h1>Gras Lawn Care</h1><p>Serving Lakewood since 1994. Call today for a free quote.</p></body></html>";

// A fake bucket, so the whole capture runs with no network (same shape as the
// video-hero suite's fake).
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

/**
 * A page-shaped stub that records the ORDER of everything the capture does to
 * it, so a test can prove the shutter fired after the paint gate — not merely
 * that the gate was called at some point.
 *
 * The gates and the shot-quality guards are told apart by the marker comments
 * their in-page predicates carry (first-paint-gate / hero-surface-gate /
 * hero-content-framing / shot-blank-meter) — the same discrimination the real
 * predicates' source gives a reader.
 *
 * `paintSettles: false` makes the eager-image wait hang past every timeout —
 * the gray/blank live case this suite exists for. `heroSettles: false` makes
 * ONLY the hero-surface wait hang — the mirror's gray phone shot, where chrome
 * paint passed but the hero never confirmed. `failNetworkIdle: true` makes
 * only a BEFORE page's networkidle navigation blow its deadline (a slow
 * third-party beacon), exercising the historical load fallback.
 *
 * `meterPlan` models the post-shot blank guard (2026-09-05, audit A4):
 *   "clean"   — every measured shot reads healthy (std 72 / flat 18);
 *   "blank"   — the first shot reads as a slab; a measurement taken after a
 *               FORCED re-frame (the retry's scroll-to-content) reads healthy;
 *   "always-blank" — every measurement reads as a slab (the retry cannot
 *               rescue a genuinely flat page).
 */
function recordingBrowser({ paintSettles = true, heroSettles = true, failNetworkIdle = false, meterPlan = "clean" } = {}) {
  const state = { pages: [] };
  const makePage = () => {
    const page = {
      role: null,
      events: [],
      viewport: null,
      pendingFrames: "paint_frames",
      meterCalls: 0,
      forcedFrames: 0,
      async route(pattern) { this.events.push({ type: "route", pattern }); },
      async emulateMedia(options) { this.events.push({ type: "emulate_media", options }); },
      async goto(url, options = {}) {
        const waitUntil = String(options.waitUntil || "load");
        if (!this.role) this.role = /wss-ai\.com/.test(url) ? "mirror" : "before";
        this.events.push({ type: "goto", url, waitUntil });
        if (this.role === "before" && failNetworkIdle && waitUntil === "networkidle") {
          throw new Error(`Timeout ${options.timeout}ms exceeded waiting for networkidle`);
        }
        this.current = url;
        return { status: () => 200 };
      },
      async content() { return REAL_HOUSE_HTML; },
      // The blank meter re-hosts the page on its own canvas markup — recorded
      // as blank_meter so "no card was rendered" (set_content) still means no
      // CARD, and the guard's runs stay assertable on their own.
      async setContent(html) {
        if (/shot-blank-meter/.test(String(html || ""))) { this.events.push({ type: "blank_meter" }); return; }
        this.events.push({ type: "set_content" });
        this.current = "placeholder";
      },
      async waitForFunction(fn, arg, options) {
        const hero = /hero-surface-gate/.test(String(fn));
        this.pendingFrames = hero ? "hero_frames" : "paint_frames";
        this.events.push({ type: hero ? "hero_gate" : "paint_gate", timeout: options && options.timeout });
        if (hero ? !heroSettles : !paintSettles) {
          throw new Error(`Timeout ${(options && options.timeout) || 0}ms exceeded`);
        }
      },
      async evaluate(fn, arg) {
        const source = String(fn);
        if (/hero-content-framing/.test(source)) {
          if (arg && arg.force) this.forcedFrames += 1;
          this.events.push({ type: "frame_hero", force: Boolean(arg && arg.force) });
          return { action: "scrolled", anchor: "h1" };
        }
        if (/shot-blank-meter/.test(source)) {
          this.meterCalls += 1;
          this.events.push({ type: "blank_measure", call: this.meterCalls });
          if (meterPlan === "clean") return { std: 72, flatPct: 18 };
          if (meterPlan === "always-blank") return { std: 9, flatPct: 88 };
          // "blank": the first shot is a slab; a measurement after the retry's
          // forced re-frame reads the content the scroll brought into frame.
          return this.forcedFrames > 0 ? { std: 74, flatPct: 16 } : { std: 9, flatPct: 88 };
        }
        this.events.push({ type: this.pendingFrames });
      },
      async waitForTimeout(ms) { this.events.push({ type: "settle", ms }); },
      async screenshot(shotOptions) {
        this.shots = (this.shots || 0) + 1;
        this.events.push({ type: "shutter", options: shotOptions, shot: this.shots });
        return Buffer.from(`jpeg:${this.current}#${this.shots}`);
      },
      async close() {},
      url() { return this.current || "about:blank"; },
    };
    return page;
  };
  return {
    state,
    async newPage(options) {
      const page = makePage();
      page.viewport = (options && options.viewport) || null;
      state.pages.push(page);
      return page;
    },
    async close() {},
  };
}

const beforePages = (browser) => browser.state.pages.filter((page) => page.role === "before");
const typesOf = (page) => page.events.map((event) => event.type);

// ---------------------------------------------------------------------------
// 1. THE SHUTTER FIRES AFTER THE PAINT GATE — order pinned, both devices
// ---------------------------------------------------------------------------

test("every before shot runs the first-paint gate BEFORE its settle and shutter — desktop and phone", async () => {
  const bucket = fakeBucket();
  const browser = recordingBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-paint-gate",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));

    const befores = beforePages(browser);
    assert.equal(befores.length, 2, "old + old-mobile");
    const [desktop, phone] = befores;
    // The phone half is genuinely the mobile viewport, not a resized desktop.
    assert.equal(Boolean(phone.viewport && phone.viewport.isMobile), true, "the second before page is not the phone capture");

    for (const page of befores) {
      // ORDER: navigation settled, THEN the paint gate, THEN the two-frame
      // paint settle, THEN the fixed 1200ms settle, the shutter — and, since
      // 2026-09-05, the post-shot blank meter (A4) re-hosting the page to
      // measure the shot's own pixels.
      assert.deepEqual(typesOf(page), ["goto", "paint_gate", "paint_frames", "settle", "shutter", "blank_meter", "blank_measure"],
        `wrong capture order on a before page: ${JSON.stringify(page.events.map((e) => e.type))}`);
      const settle = page.events.find((event) => event.type === "settle");
      assert.equal(settle.ms, 1200, "the historical before settle is kept after the gate");
      // BOUNDED: the gate carries a real timeout — never unbounded, never 0.
      const gate = page.events.find((event) => event.type === "paint_gate");
      assert.ok(Number.isFinite(gate.timeout) && gate.timeout >= 1000, `unbounded paint wait: ${gate.timeout}`);
      // THE HONEST-STRANGER LAWS SURVIVE: no interception, no emulation.
      assert.equal(page.events.some((event) => event.type === "route"), false, "interception installed on their site");
      assert.equal(page.events.some((event) => event.type === "emulate_media"), false, "emulation applied to their site");
      // A settled paint is NOT a degraded one — no waitDegraded anywhere.
      assert.equal(page.events.some((event) => event.type === "set_content"), false, "a live capture rendered the placeholder card");
    }
    // Settled captures carry no degradation marker.
    assert.ok(out.results.filter((r) => /^old/.test(r.variant)).every((r) => !r.capture_wait_degraded), JSON.stringify(out.results));
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. THE NETWORKIDLE → LOAD FALLBACK STILL PAINTS BEFORE THE SHUTTER
// ---------------------------------------------------------------------------

test("a before site whose networkidle times out falls back to load — and the paint gate still gates the shutter", async () => {
  const bucket = fakeBucket();
  // Only the BEFORE page's networkidle navigation blows its deadline (a slow
  // third-party beacon); the load fallback is the historical second attempt.
  const browser = recordingBrowser({ failNetworkIdle: true });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-load-fallback-paint",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    for (const page of beforePages(browser)) {
      const gotos = page.events.filter((event) => event.type === "goto").map((event) => event.waitUntil);
      assert.deepEqual(gotos, ["networkidle", "load"], "the historical fallback is untouched");
      // The gate still ran, after the LAST navigation and before the shutter.
      const order = typesOf(page);
      assert.equal(order.indexOf("paint_gate") > order.lastIndexOf("goto"), true, "the paint gate did not follow the navigation");
      assert.equal(order.indexOf("paint_gate") < order.indexOf("shutter"), true, "the shutter fired before the paint gate");
    }
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. A PAGE THAT NEVER SETTLES IS STILL SHOT — THE MISS IS NAMED
// ---------------------------------------------------------------------------

test("a before page whose paint never settles is still shot, with capture_wait_degraded:paint_wait_timeout named", async () => {
  const bucket = fakeBucket();
  const browser = recordingBrowser({ paintSettles: false });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-paint-never-settles",
      browser,
    });
    // THE GATE MAY ONLY WAIT, NEVER REFUSE: a stranger's page is still shot,
    // exactly as before the gate existed — the send is not lost.
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(out.shots.old_captured_url, THEIR_SITE);
    for (const page of beforePages(browser)) {
      assert.equal(page.events.some((event) => event.type === "shutter"), true, "the shutter did not fire on an unsettled page");
      // The two-frame settle is skipped when the eager-image wait timed out —
      // the named degradation below is the record of exactly that.
      assert.equal(typesOf(page).includes("paint_gate"), true);
    }
    // Named, not silent: the result and the sidecar both carry the marker.
    const old = out.results.find((r) => r.variant === "old");
    assert.equal(old.capture_wait_degraded, "paint_wait_timeout");
    const metaRaw = bucket.objects.get(`wss-proof-assets/${proofMetaPath({ url: THEIR_SITE, variant: "old" })}`)
      || bucket.objects.get(proofMetaPath({ url: THEIR_SITE, variant: "old" }));
    assert.ok(metaRaw, "the sidecar was written");
    assert.equal(JSON.parse(metaRaw.toString("utf8")).capture_wait_degraded, "paint_wait_timeout");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. THE MIRROR LANE GATES ITS SHUTTER BEHIND FIRST PAINT AND THE HERO SURFACE
//    — domcontentloaded + two gates, never networkidle
// ---------------------------------------------------------------------------

test("the mirror lane navigates domcontentloaded, then first paint, then the hero surface, then settles — on both devices", async () => {
  const bucket = fakeBucket();
  const browser = recordingBrowser();
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-mirror-gate",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    const mirrors = browser.state.pages.filter((page) => page.role === "mirror");
    assert.equal(mirrors.length, 2, "new + new-mobile");
    const [desktop, phone] = mirrors;
    assert.equal(Boolean(phone.viewport && phone.viewport.isMobile), true, "the second mirror page is not the phone capture");
    for (const page of mirrors) {
      // ORDER: media policy, navigation, FIRST-PAINT gate + two frames, then
      // the HERO gate + two frames (poster/video confirmed in-viewport), then
      // HERO-AWARE FRAMING (2026-09-05, A4: the frame moves to the content
      // anchor when the hero starts below the fold), then the fixed settle,
      // the shutter, and the blank meter. Chrome paint alone may not fire the
      // shutter on a video/poster mirror — that is the gray phone shot.
      assert.deepEqual(typesOf(page), ["route", "emulate_media", "goto", "paint_gate", "paint_frames", "hero_gate", "hero_frames", "frame_hero", "settle", "shutter", "blank_meter", "blank_measure"],
        `wrong mirror capture order: ${JSON.stringify(page.events.map((e) => e.type))}`);
      const gate = page.events.find((event) => event.type === "paint_gate");
      assert.ok(Number.isFinite(gate.timeout) && gate.timeout >= 1000, `unbounded mirror paint wait: ${gate.timeout}`);
      // BOUNDED: the hero wait carries a real timeout too — never unbounded,
      // never 0 — and never exceeds the variant's navigation envelope.
      const heroGate = page.events.find((event) => event.type === "hero_gate");
      assert.ok(Number.isFinite(heroGate.timeout) && heroGate.timeout >= 1000, `unbounded mirror hero wait: ${heroGate.timeout}`);
      assert.ok(heroGate.timeout <= 45_000, `hero wait outside the slice envelope: ${heroGate.timeout}`);
      // A settled hero is not a degraded one — no waitDegraded anywhere.
      assert.equal(typesOf(page).includes("set_content"), false);
    }
    assert.ok(out.results.every((r) => !r.capture_wait_degraded), JSON.stringify(out.results));
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. A MIRROR WHOSE HERO NEVER CONFIRMS IS STILL SHOT — THE MISS IS NAMED
// ---------------------------------------------------------------------------

test("a mirror whose hero surface never confirms is still shot, with capture_wait_degraded:mirror_paint_timeout named", async () => {
  const bucket = fakeBucket();
  // Chrome paint passed (the eager gate settles) but the hero never did: the
  // video has no decoded frame and no poster image decoded real pixels past
  // every timeout — the delivered V3 email's gray NEW-site phone shot.
  const browser = recordingBrowser({ heroSettles: false });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-hero-never-settles",
      browser,
    });
    // THE GATE MAY ONLY WAIT, NEVER REFUSE: the pair still completed — the
    // phone shot the email depends on exists and passed identity.
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.match(out.shots.new_captured_url, /wss-ai\.com/);
    assert.match(String(out.shots.new_mobile_captured_url || ""), /wss-ai\.com/, "the phone shot still shipped");
    for (const page of browser.state.pages.filter((p) => p.role === "mirror")) {
      assert.equal(page.events.some((event) => event.type === "shutter"), true, "the shutter did not fire on an unsettled hero");
      // ORDER on the miss: first paint, hero gate times out, two frames are
      // still attempted, THEN the bounded extra settle (the fail-open beat
      // the hero earns), then hero-aware framing, then the historical 1500ms
      // settle, then shutter, then the blank meter.
      assert.deepEqual(typesOf(page),
        ["route", "emulate_media", "goto", "paint_gate", "paint_frames", "hero_gate", "hero_frames", "settle", "frame_hero", "settle", "shutter", "blank_meter", "blank_measure"],
        `wrong miss-path capture order: ${JSON.stringify(page.events.map((e) => e.type))}`);
      const settles = page.events.filter((event) => event.type === "settle").map((event) => event.ms);
      assert.deepEqual(settles, [1000, 1500], `the fail-open settle must be the bounded ~1000ms beat, not open-ended: ${JSON.stringify(settles)}`);
    }
    // Named, not silent: the result and the sidecar both carry the marker,
    // for the phone variant too — the shot the email actually renders.
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.capture_wait_degraded, "mirror_paint_timeout");
    const afterPhone = out.results.find((r) => r.variant === "new-mobile");
    assert.equal(afterPhone.capture_wait_degraded, "mirror_paint_timeout");
    const metaRaw = bucket.objects.get(`wss-proof-assets/${proofMetaPath({ url: MIRROR, variant: "new-mobile" })}`)
      || bucket.objects.get(proofMetaPath({ url: MIRROR, variant: "new-mobile" }));
    assert.ok(metaRaw, "the sidecar was written");
    assert.equal(JSON.parse(metaRaw.toString("utf8")).capture_wait_degraded, "mirror_paint_timeout");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 6. THE POST-SHOT BLANK GUARD (2026-09-05, audit A4) — a uniform first frame
//    earns ONE scroll-to-content retry; the outcome is NAMED, never silent
// ---------------------------------------------------------------------------

test("a blank first mirror shot is retried once with scroll-to-content framing and named shot_blank_retried", async () => {
  const bucket = fakeBucket();
  // The first shot measures as a slab (std 9 / flat 88 — audit A4's FAIL band);
  // after the retry's forced re-frame the meter reads real content.
  const browser = recordingBrowser({ meterPlan: "blank" });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-blank-retry",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));

    for (const page of browser.state.pages.filter((p) => p.role === "mirror")) {
      // TWO shutters, exactly: the first (blank) frame and the retry. The
      // forced re-frame ran between the first measurement and the retry.
      const shutters = page.events.filter((event) => event.type === "shutter");
      assert.equal(shutters.length, 2, `exactly one blank retry: ${JSON.stringify(page.events.map((e) => e.type))}`);
      const firstMeasure = page.events.findIndex((event) => event.type === "blank_measure");
      const forcedFrame = page.events.findIndex((event) => event.type === "frame_hero" && event.force);
      assert.ok(firstMeasure >= 0 && forcedFrame > firstMeasure, "the retry's forced re-frame followed the blank measurement");
      assert.ok(page.events.findIndex((event) => event.type === "shutter") < firstMeasure, "the shot was measured after the shutter");
    }

    // The RETRY's pixels are what shipped — the stored object ends in the
    // second stub frame — and the outcome is named on the result + sidecar.
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.shot_blank_check, "shot_blank_retried");
    assert.equal(after.shot_luma_std, 74, "the measured stats ride the result");
    const stored = bucket.objects.get(`wss-proof-assets/${proofObjectPath({ url: MIRROR, variant: "new" })}`)
      || bucket.objects.get(proofObjectPath({ url: MIRROR, variant: "new" }));
    assert.ok(stored, "the shot was stored");
    assert.match(stored.toString("utf8"), /#2$/, "the stored shot is the retried frame, not the blank one");
    const metaRaw = bucket.objects.get(`wss-proof-assets/${proofMetaPath({ url: MIRROR, variant: "new" })}`)
      || bucket.objects.get(proofMetaPath({ url: MIRROR, variant: "new" }));
    assert.equal(JSON.parse(metaRaw.toString("utf8")).shot_blank_check, "shot_blank_retried");
  } finally {
    bucket.restore();
  }
});

test("a shot that stays blank after the retry is accepted and named shot_blank_accepted", async () => {
  const bucket = fakeBucket();
  // A genuinely flat page: both measurements read as slabs — a flat site is
  // still their site, so the shot ships with the miss NAMED, never lost.
  const browser = recordingBrowser({ meterPlan: "always-blank" });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-blank-accepted",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    const after = out.results.find((r) => r.variant === "new");
    assert.equal(after.shot_blank_check, "shot_blank_accepted");
    assert.equal(after.shot_luma_std, 9, "the accepted stats ride the result");
    const metaRaw = bucket.objects.get(`wss-proof-assets/${proofMetaPath({ url: MIRROR, variant: "new" })}`)
      || bucket.objects.get(proofMetaPath({ url: MIRROR, variant: "new" }));
    const meta = JSON.parse(metaRaw.toString("utf8"));
    assert.equal(meta.shot_blank_check, "shot_blank_accepted");
    assert.equal(meta.shot_luma_std, 9);
    assert.equal(meta.shot_flat_pct, 88);
    for (const page of browser.state.pages.filter((p) => p.role === "mirror")) {
      assert.equal(page.events.filter((event) => event.type === "shutter").length, 2,
        "the retry fired even though it could not rescue the frame");
      // EXACTLY one retry, never more.
      assert.equal(page.events.filter((event) => event.type === "blank_measure").length, 2);
    }
  } finally {
    bucket.restore();
  }
});

test("a clean shot never pays for the guard: one shutter, no retry, no marker", async () => {
  const bucket = fakeBucket();
  const browser = recordingBrowser({ meterPlan: "clean" });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-blank-clean",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    for (const page of browser.state.pages) {
      assert.equal(page.events.filter((event) => event.type === "shutter").length, 1,
        `a healthy page is shot exactly once: ${JSON.stringify(page.events.map((e) => e.type))}`);
    }
    assert.ok(out.results.every((r) => !r.shot_blank_check), JSON.stringify(out.results));
  } finally {
    bucket.restore();
  }
});
