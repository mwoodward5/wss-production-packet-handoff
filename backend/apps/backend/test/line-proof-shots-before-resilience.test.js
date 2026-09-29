"use strict";

// test/line-proof-shots-before-resilience.test.js
//
// THE MINED-PROSPECT BEFORE-SHOT FAILURE, PINNED (2026-09-02): smoke batch
// line_mtl0s1bf produced six gate_passed rows with LIVE mirrors (Forbes,
// WyattWorks, Three Way Plumbing, Hurricane Fence, Builders Fence, Rocky
// Mountain Electric) that refused force-send with
// force_send_refused:no_before_after_visuals. The AFTER (mirror) side was
// already fixed by the media policy; the failing side was the BEFORE — the
// prospect's CURRENT external website, which bot-walls, 403/503s and slow
// origins in a way our mirrors never do.
//
// The contract these tests hold:
//   · a classified bot-block (403/429/503, challenge markers, empty render)
//     falls back to public archives of the SAME domain — archive.today, then
//     the Wayback Machine's most recent 200 capture;
//   · when even the archives have nothing, the before slot is filled with a
//     locally-rendered disclosure card and the state is NAMED
//     (before_unavailable:<reason>) on the record — honest disclosed-absence
//     beats zero emails (owner directive);
//   · once the AFTER pair is secured, BEFORE gets the REMAINING budget, not a
//     fixed 45s slice — slow external sites are the expected case;
//   · a slow but HONEST external site still gets the live shot with the
//     strategy that is honest about a stranger's page (networkidle → load,
//     1200ms settle, no interception) — plus, since 2026-09-03, the shared
//     first-paint gate ahead of that settle (the gray/blank fix) — and never
//     touches the fallback chain;
//   · the gate treats the named state as renderable-with-disclosure, and can
//     still be masked by neither a missing after image nor a bad before one.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://stub.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "stub-service-key";

const { proofMetaPath, proofObjectPath } = require("../lib/proof-storage");
const {
  ensureLineProofShots,
  classifyBeforeNavigation,
  placeholderCardHtml,
  BEFORE_CHALLENGE_MARKERS,
  BEFORE_EXTENDED_NAV_CEILING_MS,
} = require("../lib/line-proof-shots");
const {
  automaticProofShotRecord,
  assetsAreCurrent,
} = require("../lib/line-email-assets");
const {
  composeOutreachEmailV2,
  proofReadiness,
  beforeUnavailableStateOf,
  namedBeforeUnavailable,
} = require("../lib/outreach-email-v2");

const MIRROR = "https://wss-test-gras-lawn-lakewood.wss-ai.com/";
const THEIR_SITE = "https://graslawn.example/";
const REAL_HOUSE_HTML = "<html><body><h1>Gras Lawn Care</h1><p>Serving Lakewood since 1994. Call today for a free quote.</p></body></html>";
const CHALLENGE_HTML = '<html><head><title>Just a moment...</title></head><body><div id="cf-challenge">_cf_chl_opt challenge-platform</div></body></html>';
const SNAPSHOT_URL = "https://web.archive.org/web/20250315000000/https://graslawn.example/";

// ---------------------------------------------------------------------------
// A fake bucket PLUS a fake wayback availability API on one fetch stub, so the
// whole capture runs with no network (same shape as the video-hero suite).
// ---------------------------------------------------------------------------
function fakeNet({ availableApi = null } = {}) {
  const objects = new Map();
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push(target);
    if (/archive\.org\/wayback\/available/.test(target)) {
      return { ok: true, status: 200, json: async () => (availableApi || { archived_snapshots: {} }) };
    }
    if ((options.method || "GET").toUpperCase() === "POST") {
      const key = target.split("/object/")[1] || target;
      objects.set(key, Buffer.from(options.body));
      return { ok: true, status: 200, text: async () => "", headers: new Map() };
    }
    const key = target.split("/public/wss-proof-assets/")[1] || "";
    const hit = objects.get(`wss-proof-assets/${key}`) || objects.get(key);
    if (!hit) return { ok: false, status: 404, headers: { get: () => "" }, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      headers: { get: (h) => (/content-type/i.test(h) ? "application/json" : "") },
      arrayBuffer: async () => hit.buffer.slice(hit.byteOffset, hit.byteOffset + hit.byteLength),
    };
  };
  return { objects, calls, restore() { global.fetch = realFetch; } };
}

// ---------------------------------------------------------------------------
// A browser-shaped stub. The prospect's live site, the archive lanes and the
// locally-rendered card are all modelled; mirrors settle at domcontentloaded
// like the video-hero suite's fixed behaviour.
// ---------------------------------------------------------------------------
function resilienceBrowser(spec = {}) {
  const live = {
    status: 200,
    html: REAL_HOUSE_HTML,
    failNetworkIdle: false,
    failLoad: false,
    ...(spec.live || {}),
  };
  const archiveToday = { mode: "fail", ...(spec.archiveToday || {}) }; // fail | ok | captcha
  const wayback = { snapshot: true, snapshotHtml: "<html><body><h1>Gras Lawn Care</h1><p>The archived copy of their own page, fully rendered.</p></body></html>", ...(spec.wayback || {}) };
  const mirror = { fail: false, ...(spec.mirror || {}) };
  const state = { pages: [], browserCloses: 0 };

  const makePage = () => {
    const page = {
      role: null,
      gotos: [],
      waits: [],
      waitForFunctionCalls: [],
      paintFrameEvaluates: 0,
      meterLoads: 0,
      shots: [],
      setContentCalls: [],
      routes: [],
      emulated: [],
      current: "about:blank",
      html: "",
      async route(pattern) { this.routes.push(pattern); },
      async emulateMedia(options) { this.emulated.push(options); },
      async goto(url, options = {}) {
        const waitUntil = String(options.waitUntil || "load");
        if (!this.role) this.role = /wss-ai\.com/.test(url) ? "mirror" : "before";
        this.gotos.push({ url, waitUntil, timeout: options.timeout });
        if (this.role === "mirror") {
          if (mirror.fail) throw new Error(`Timeout ${options.timeout}ms exceeded`);
          this.current = url;
          this.html = "<html><body><h1>The mirror</h1><p>Painted.</p></body></html>";
          return { status: () => 200 };
        }
        if (/^https:\/\/archive\.ph\//i.test(url)) {
          if (archiveToday.mode === "fail") throw new Error("archive.ph unreachable");
          this.current = url;
          this.html = archiveToday.mode === "captcha"
            ? "<html><body>Checking your browser before accessing — please solve the captcha</body></html>"
            : REAL_HOUSE_HTML;
          return { status: () => 200 };
        }
        if (/^https:\/\/web\.archive\.org\/web\/2\//i.test(url)) {
          throw new Error("wayback direct lookup refused");
        }
        if (/^https:\/\/web\.archive\.org\/web\/\d{14}\//i.test(url)) {
          if (!wayback.snapshot) throw new Error("snapshot page unavailable");
          this.current = url;
          this.html = wayback.snapshotHtml;
          return { status: () => 200 };
        }
        // THE LIVE PROSPECT SITE.
        if (waitUntil === "networkidle" && live.failNetworkIdle) throw new Error(`Timeout ${options.timeout}ms exceeded waiting for networkidle`);
        if (waitUntil === "load" && live.failLoad) throw new Error(`Timeout ${options.timeout}ms exceeded waiting for load`);
        this.current = url;
        this.html = live.html;
        return { status: () => live.status };
      },
      async content() { return this.html; },
      // The blank meter (2026-09-05) re-hosts the page with its own canvas
      // markup — counted separately so "no card was rendered" still means no
      // CARD, and the guard's presence stays assertable on its own.
      async setContent(html) {
        if (/shot-blank-meter/.test(String(html || ""))) { this.meterLoads += 1; return; }
        this.setContentCalls.push(html);
        this.html = html;
      },
      async waitForFunction(fn, arg, options) { this.waitForFunctionCalls.push(options); },
      async evaluate() { this.paintFrameEvaluates += 1; },
      async waitForTimeout(ms) { this.waits.push(ms); },
      async screenshot() {
        this.shots.push(this.current);
        return Buffer.from(`jpeg:${this.current}:${this.setContentCalls.length}:${this.shots.length}`);
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
// The stub navigates whatever timestamped snapshot URL the availability API
// handed it (spec.wayback.snapshot, default on) — that is all the fallback
// needs from the page.

function beforePages(browser) { return browser.state.pages.filter((page) => page.role === "before"); }
function metaFor(bucket, url, variant) {
  const raw = bucket.objects.get(`wss-proof-assets/${proofMetaPath({ url, variant })}`)
    || bucket.objects.get(proofMetaPath({ url, variant }));
  return raw ? JSON.parse(raw.toString("utf8")) : null;
}

// ---------------------------------------------------------------------------
// 1. THE CLASSIFIER — a wall is named, a real site is not
// ---------------------------------------------------------------------------

test("classifyBeforeNavigation names 403/429/503, challenge markers, and empty renders — and passes real pages", async () => {
  const blocked503 = await classifyBeforeNavigation({
    page: { content: async () => REAL_HOUSE_HTML },
    response: { status: () => 503 },
  });
  assert.deepEqual({ blocked: blocked503.blocked, reason: blocked503.reason }, { blocked: true, reason: "http_503_unavailable" });

  const challenge = await classifyBeforeNavigation({
    page: { content: async () => CHALLENGE_HTML },
    response: { status: () => 200 },
  });
  assert.equal(challenge.blocked, true);
  assert.equal(challenge.reason, "challenge_page");

  const real = await classifyBeforeNavigation({
    page: { content: async () => REAL_HOUSE_HTML },
    response: { status: () => 200 },
  });
  assert.equal(real.blocked, false);

  // A browser build with no body access classifies as NOT blocked — the
  // classifier may only narrow what is stored, never invent a block.
  const opaque = await classifyBeforeNavigation({ page: {}, response: { status: () => 200 } });
  assert.equal(opaque.blocked, false);

  const blank = await classifyBeforeNavigation({
    page: { content: async () => "<html><body></body></html>" },
    response: { status: () => 200 },
  });
  assert.deepEqual({ blocked: blank.blocked, reason: blank.reason }, { blocked: true, reason: "empty_render" });

  // Every pinned marker is actually matched by the classifier.
  for (const marker of BEFORE_CHALLENGE_MARKERS) {
    const verdict = await classifyBeforeNavigation({
      page: { content: async () => `<html><body>${marker}</body></html>` },
      response: { status: () => 200 },
    });
    assert.equal(verdict.blocked, true, `marker not matched: ${marker}`);
  }
});

// ---------------------------------------------------------------------------
// 2. BOT-BLOCK + WAYBACK: a 403 wall resolves to a snapshot of the SAME site
// ---------------------------------------------------------------------------

test("a 403 challenge wall falls back to the wayback snapshot of the same site — a real before shot, provenance named", async () => {
  const bucket = fakeNet({
    availableApi: { archived_snapshots: { closest: { url: SNAPSHOT_URL, timestamp: "20250315000000", status: "200" } } },
  });
  const browser = resilienceBrowser({
    live: { status: 403, html: CHALLENGE_HTML },
    archiveToday: { mode: "fail" },
  });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-before-wayback",
      browser,
    });

    // THE SEND NO LONGER DIES: the before slot holds a real picture of their
    // own domain (the archived snapshot), identity intact.
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(out.shots.old_captured_url, THEIR_SITE);
    assert.match(out.shots.old_shot_sha, /^[0-9a-f]{64}$/);
    assert.equal(out.shots.before_capture_via, "wayback");
    // A wayback capture is a REAL capture — no disclosed-absence state.
    assert.equal(out.shots.before_unavailable, undefined);

    const before = out.results.find((r) => r.variant === "old");
    assert.equal(before.ok, true);
    assert.equal(before.capture_via, "wayback");
    assert.ok(before.fallback_attempted.some((s) => /^archive_today_failed:/.test(s)),
      "the failed archive.today lane is named in the report");

    // THE CHAIN: archive.today was attempted (and failed), then the
    // availability API was consulted for the most recent capture, and the
    // snapshot page itself was navigated.
    assert.ok(bucket.calls.some((u) => u.includes(`archive.org/wayback/available?url=${encodeURIComponent(THEIR_SITE)}`)));
    const oldPage = beforePages(browser)[0];
    assert.ok(oldPage.gotos.some((g) => /^https:\/\/archive\.ph\/newest\//.test(g.url)), "archive.today was tried first");
    assert.ok(oldPage.gotos.some((g) => g.url === SNAPSHOT_URL), "the snapshot page was navigated");

    // THE SIDECAR KEEPS THE FULL ACCOUNT: the attested URL is their domain,
    // and where the browser actually stood is recorded beside it.
    const meta = metaFor(bucket, THEIR_SITE, "old");
    assert.equal(meta.captured_url, THEIR_SITE);
    assert.equal(meta.capture_via, "wayback");
    assert.equal(meta.archive_landed_url, SNAPSHOT_URL);
    assert.equal(meta.before_unavailable, undefined);
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 2b. ARCHIVE PARITY FOR THE PHONE HALF (audit A4 defect B, 2026-09-05)
// ---------------------------------------------------------------------------

test("a bot-walled site's PHONE before gets the same wayback snapshot as the desktop — the pair matches", async () => {
  const bucket = fakeNet({
    availableApi: { archived_snapshots: { closest: { url: SNAPSHOT_URL, timestamp: "20250315000000", status: "200" } } },
  });
  const browser = resilienceBrowser({
    live: { status: 403, html: CHALLENGE_HTML },
    archiveToday: { mode: "fail" },
  });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-before-wayback-parity",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));

    // BOTH before slots hold the archived snapshot, not just the desktop one —
    // the delivered email's mismatched pair (real desktop archive beside a
    // near-black phone card of the SAME site) is the defect this pins shut.
    assert.equal(out.shots.old_captured_url, THEIR_SITE);
    assert.match(String(out.shots.old_mobile_captured_url || ""), /graslawn\.example/,
      "the phone before slot was recorded");
    for (const variant of ["old", "old-mobile"]) {
      const result = out.results.find((r) => r.variant === variant);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.capture_via, "wayback", `${variant} resolved via wayback`);
      assert.equal(result.before_unavailable, undefined, `${variant} is a real capture, not a disclosed absence`);
    }
    const mobileMeta = metaFor(bucket, THEIR_SITE, "old-mobile");
    assert.equal(mobileMeta.capture_via, "wayback");
    assert.equal(mobileMeta.archive_landed_url, SNAPSHOT_URL);

    // The phone page navigated the snapshot at its own (mobile) viewport.
    const pages = beforePages(browser);
    assert.equal(pages.length, 2, "old + old-mobile");
    assert.ok(pages[1].gotos.some((g) => g.url === SNAPSHOT_URL),
      "the phone half navigated the wayback snapshot itself");
    assert.deepEqual(
      pages[1].gotos.map((g) => g.url),
      pages[0].gotos.map((g) => g.url),
      "phone and desktop ran the identical fallback chain",
    );
    // No disclosure card was needed on either half.
    assert.ok(pages.every((page) => page.setContentCalls.length === 0));
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 3. ALL ALTERNATES FAIL: the disclosed-absence card, named on the record
// ---------------------------------------------------------------------------

test("a blocked site with no usable archive gets the disclosure card, named before_unavailable — the send no longer dies", async () => {
  const bucket = fakeNet({ availableApi: null }); // no wayback capture
  const browser = resilienceBrowser({
    live: { status: 503, html: "" },
    archiveToday: { mode: "fail" },
  });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-before-placeholder",
      browser,
    });

    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(out.shots.old_captured_url, THEIR_SITE);
    assert.equal(out.shots.before_capture_via, "placeholder");
    assert.equal(out.shots.before_unavailable, "http_503_unavailable");

    const before = out.results.find((r) => r.variant === "old");
    assert.equal(before.ok, true);
    assert.equal(before.capture_via, "placeholder");
    assert.equal(before.before_unavailable, "http_503_unavailable");
    assert.ok(before.fallback_attempted.includes("archive_today"));
    assert.ok(before.fallback_attempted.includes("wayback"));
    assert.ok(before.fallback_attempted.includes("placeholder"));

    // THE CARD IS THE DISCLOSURE: rendered locally, saying exactly what
    // happened, in both viewports (desktop old + mobile old-mobile).
    const pages = beforePages(browser);
    assert.ok(pages.length >= 2, "old and old-mobile both rendered");
    assert.ok(pages.every((page) => page.setContentCalls.length === 1), JSON.stringify(pages.map((p) => p.setContentCalls.length)));
    assert.match(pages[0].setContentCalls[0], /unavailable for capture/);
    assert.match(pages[0].setContentCalls[0], /graslawn\.example/);
    // ARCHIVE PARITY (2026-09-05, audit A4 defect B): the mobile before runs
    // the SAME fallback chain as the desktop before — the exact URL sequence —
    // so a bot-walled site can never again pair a real desktop archive with a
    // black apology card on the phone of the SAME site.
    assert.deepEqual(
      pages[1].gotos.map((g) => g.url),
      pages[0].gotos.map((g) => g.url),
      "the mobile fallback chain must match the desktop lane, URL for URL",
    );
    assert.ok(pages[1].gotos.some((g) => /^https:\/\/archive\.ph\/newest\//.test(g.url)), "the phone half attempted archive.today");
    assert.ok(pages[1].gotos.some((g) => /^https:\/\/web\.archive\.org\//.test(g.url)), "the phone half attempted wayback");

    // THE SIDECAR NAMES IT TOO, and the identity law still holds: the attested
    // URL is their own domain, so nothing downstream may refuse it as foreign.
    const meta = metaFor(bucket, THEIR_SITE, "old");
    assert.equal(meta.captured_url, THEIR_SITE);
    assert.equal(meta.capture_via, "placeholder");
    assert.equal(meta.before_unavailable, "http_503_unavailable");

    // THE ASSET RECORD IS COMPLETE — a disclosed card is still a complete,
    // honest before/after proof contract (after side fully captured above).
    const record = automaticProofShotRecord(out, { currentWebsite: THEIR_SITE });
    assert.ok(record, "the placeholder capture satisfies the automatic record contract");
    assert.equal(record.before_unavailable, "http_503_unavailable");
  } finally {
    bucket.restore();
  }
});

test("a reused disclosure card keeps its marker — a reuse that dropped before_unavailable would pass a card off as a verified shot", async () => {
  const bucket = fakeNet({ availableApi: null });
  const browser = resilienceBrowser({
    live: { status: 403, html: CHALLENGE_HTML },
    archiveToday: { mode: "captcha" },
  });
  try {
    const first = await ensureLineProofShots({
      currentWebsite: THEIR_SITE, previewUrl: MIRROR, buildHash: "build-reuse", browser,
    });
    assert.equal(first.ok, true, JSON.stringify(first.results));
    assert.equal(first.shots.before_capture_via, "placeholder");
    const beforePageCount = beforePages(browser).length;
    assert.ok(beforePageCount >= 2);

    const second = await ensureLineProofShots({
      currentWebsite: THEIR_SITE, previewUrl: MIRROR, buildHash: "build-reuse", browser,
    });
    assert.equal(second.ok, true, JSON.stringify(second.results));
    assert.equal(second.shots.old_captured_url, THEIR_SITE);
    assert.equal(second.shots.old_shot_sha, first.shots.old_shot_sha);
    assert.equal(second.shots.before_capture_via, "placeholder", "provenance rides the reuse");
    assert.equal(second.shots.before_unavailable, "http_403_forbidden", "the named state rides the reuse");
    assert.equal(beforePages(browser).length, beforePageCount, "no page was opened for a reused shot");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 4. THE REGRESSION: a slow but honest site still gets the live shot only
// ---------------------------------------------------------------------------

test("a slow external site (networkidle times out, load settles) still gets the live shot — no archive detours, paint-gated", async () => {
  const bucket = fakeNet({ availableApi: null });
  const browser = resilienceBrowser({ live: { failNetworkIdle: true } });
  try {
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-before-slow-live",
      browser,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    assert.equal(out.shots.old_captured_url, THEIR_SITE);
    assert.equal(out.shots.before_capture_via, undefined);
    assert.equal(out.shots.before_unavailable, undefined);

    for (const page of beforePages(browser)) {
      assert.deepEqual(page.gotos.map((g) => g.waitUntil), ["networkidle", "load"],
        "the historical before strategy is untouched");
      assert.deepEqual(page.waits, [1200], "the before settle is unchanged");
      // THE FIRST-PAINT GATE (2026-09-03): the live before lane runs the
      // shared paint gate ahead of its settle — the gray/blank fix — bounded
      // by the variant's slice. It may only WAIT, never refuse, so a live
      // honest site keeps its shot with no degradation marker.
      assert.ok(page.waitForFunctionCalls.length >= 1, "the paint gate did not run on the live before lane");
      assert.ok(page.waitForFunctionCalls.every((o) => Number(o && o.timeout) >= 1000),
        "the paint wait must be bounded, never unbounded");
      assert.ok(page.paintFrameEvaluates >= 1, "the two-frame paint settle did not run");
      assert.equal(page.setContentCalls.length, 0, "no card was rendered for a site that answered");
      // THE BLANK GUARD RAN (2026-09-05, audit A4): the live shot's pixels are
      // measured after the shutter — the meter re-host is not a card render.
      assert.ok(page.meterLoads >= 1, "the post-shot blank meter did not run on the live lane");
      assert.equal(page.routes.length, 0, "no interception is ever installed on their site");
      assert.equal(page.emulated.length, 0, "no emulation is ever applied to their site");
    }
    const result = out.results.find((r) => r.variant === "old");
    assert.equal(result.capture_via, undefined, "a live capture carries no fallback provenance");
    assert.equal(result.capture_wait_degraded, undefined, "a settled paint is not a degraded one");
    // The availability API was never consulted.
    assert.ok(bucket.calls.every((u) => !/archive\.org\/wayback/.test(u)));
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 5. THE BUDGET: BEFORE gets the remaining budget once AFTER is secured
// ---------------------------------------------------------------------------

function seedMirrorShot(bucket, { variant, buildHash }) {
  const sha = "a".repeat(64);
  const meta = {
    schema: "wss-proof-shot-meta-v2",
    variant,
    requested_url: MIRROR,
    captured_url: MIRROR,
    captured_domain: "wss-ai.com",
    bytes: 32,
    build_hash: buildHash,
    shot_sha256: sha,
    captured_at: new Date(0).toISOString(),
  };
  const metaPath = proofMetaPath({ url: MIRROR, variant });
  bucket.objects.set(`wss-proof-assets/${metaPath}`, Buffer.from(JSON.stringify(meta)));
  const objectPath = proofObjectPath({ url: MIRROR, variant });
  bucket.objects.set(`wss-proof-assets/${objectPath}`, Buffer.from("stored-jpeg"));
}

test("with the AFTER pair secured, BEFORE gets the remaining budget — not the fixed 45s slice", async () => {
  const bucket = fakeNet({});
  seedMirrorShot(bucket, { variant: "new", buildHash: "build-budget" });
  seedMirrorShot(bucket, { variant: "new-mobile", buildHash: "build-budget" });
  // Distinct before URLs per scenario: old-family shots are keyed by URL and
  // reused across runs, so each scenario needs its own uncaptured site.
  const deadlineBrowser = resilienceBrowser({});
  const openBrowser = resilienceBrowser({});
  try {
    const NOW = 1_000_000;
    const out = await ensureLineProofShots({
      currentWebsite: "https://graslawn.example/budget-deadline",
      previewUrl: MIRROR,
      buildHash: "build-budget",
      browser: deadlineBrowser,
      deadlineAt: NOW + 80_000,
      now: () => NOW,
    });
    assert.equal(out.ok, true, JSON.stringify(out.results));
    const oldPage = beforePages(deadlineBrowser)[0];
    // 2026-09-04 (batch line_mtmvwmyn): the before lane runs INSIDE the gate's
    // inspection budget, so the extended slice is capped at 45s even when more
    // remains — remaining (80s) minus the 4s reserve would hand a stranger's
    // site 76 of the gate's 150s and is what let a healthy build blow the
    // whole deadline on every retry.
    assert.equal(oldPage.gotos[0].timeout, BEFORE_EXTENDED_NAV_CEILING_MS,
      "the remaining budget still applies, capped at the 45s absolute ceiling");

    // No deadline (the send-path fallback capture): the absolute ceiling.
    const openOut = await ensureLineProofShots({
      currentWebsite: "https://graslawn.example/budget-open",
      previewUrl: MIRROR,
      buildHash: "build-budget",
      browser: openBrowser,
    });
    assert.equal(openOut.ok, true, JSON.stringify(openOut.results));
    assert.equal(beforePages(openBrowser)[0].gotos[0].timeout, BEFORE_EXTENDED_NAV_CEILING_MS);
  } finally {
    bucket.restore();
  }
});

test("without a secured AFTER pair, BEFORE keeps the historical divided slice", async () => {
  const bucket = fakeNet({});
  const browser = resilienceBrowser({ mirror: { fail: true } });
  try {
    const NOW = 2_000_000;
    const out = await ensureLineProofShots({
      currentWebsite: THEIR_SITE,
      previewUrl: MIRROR,
      buildHash: "build-no-after",
      browser,
      deadlineAt: NOW + 30_000,
      now: () => NOW,
    });
    // The AFTER side failed (that is the point), so the BEFORE variants never
    // get the extended budget: the historical envelope holds exactly.
    const oldResult = out.results.find((r) => r.variant === "old");
    const oldPage = beforePages(browser)[0];
    assert.equal(oldPage.gotos[0].timeout, Math.floor((30_000 - 2_500) / 2), JSON.stringify(out.results));
    assert.equal(oldResult.ok, true, "the live shot itself still succeeds");
  } finally {
    bucket.restore();
  }
});

// ---------------------------------------------------------------------------
// 6. THE GATE: before_unavailable is renderable-with-disclosure, and only that
// ---------------------------------------------------------------------------

test("proofReadiness treats a named before_unavailable as renderable-with-disclosure; fail-closed without it", () => {
  const base = {
    previewUrl: MIRROR,
    beforeImage: "",
    afterImage: "https://ghost.wss-ai.com/proof/new.jpg",
    requireComparison: true,
  };

  const disclosed = proofReadiness({
    ...base,
    cta: { beforeUnavailableReason: "before_unavailable:http_403_forbidden" },
  });
  assert.equal(disclosed.ok, true, JSON.stringify(disclosed));
  assert.equal(disclosed.comparison, "disclosed");
  assert.equal(disclosed.beforeUnavailable, "before_unavailable:http_403_forbidden");
  assert.equal(disclosed.afterImage, "https://ghost.wss-ai.com/proof/new.jpg");

  const refused = proofReadiness({ ...base, cta: {} });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "no_before_after_visuals");

  // THE AFTER VISUAL STAYS MANDATORY: the state never ships an email with no
  // site visual at all.
  const noAfter = proofReadiness({
    previewUrl: MIRROR,
    beforeImage: "",
    afterImage: "",
    cta: { beforeUnavailableReason: "before_unavailable:http_403_forbidden" },
  });
  assert.equal(noAfter.ok, false);
  assert.equal(noAfter.reason, "no_before_after_visuals");

  // THE IDENTITY LAW CANNOT BE MASKED: a real before image from a stranger's
  // domain is refused even when a state is present — the disclosure path only
  // ever stands in for an image that does not exist.
  const masked = proofReadiness({
    previewUrl: MIRROR,
    beforeImage: "https://ghost.wss-ai.com/proof/old.jpg",
    afterImage: "https://ghost.wss-ai.com/proof/new.jpg",
    cta: {
      currentWebsite: THEIR_SITE,
      beforeImageSource: "https://stranger.example/",
      beforeUnavailableReason: "before_unavailable:http_403_forbidden",
    },
  });
  assert.equal(masked.ok, false);
  assert.equal(masked.reason, "before_image_capture_domain_mismatch");
});

test("assetsAreCurrent accepts a named before_unavailable as resolving the before side", () => {
  const shots = {
    build_hash: "build-seam",
    new_captured_url: MIRROR,
    new_shot_sha: "b".repeat(64),
    before_unavailable: "http_503_unavailable",
  };
  const ok = assetsAreCurrent({ shots, buildHash: "build-seam", currentWebsite: THEIR_SITE });
  assert.equal(ok.ok, true, JSON.stringify(ok));

  // An UNNAMED absence is still unresolved — the state must be on the record.
  const unnamed = assetsAreCurrent({
    shots: { build_hash: "build-seam", new_captured_url: MIRROR, new_shot_sha: "b".repeat(64) },
    buildHash: "build-seam",
    currentWebsite: THEIR_SITE,
  });
  assert.equal(unnamed.ok, false);
  assert.equal(unnamed.reason, "before_shot_unresolved");
});

// ---------------------------------------------------------------------------
// 7. THE COMPOSER: the disclosure panel renders where "YOUR SITE TODAY" would
// ---------------------------------------------------------------------------

test("the composer renders the disclosed-absence panel, and a real before image still renders the normal pair", () => {
  const disclosed = composeOutreachEmailV2({
    businessName: "Gras Lawn Care",
    city: "Lakewood",
    previewUrl: MIRROR,
    afterImage: "https://proof.wss-ai.com/new.jpg",
    beforeUnavailable: "before_unavailable:http_503_unavailable",
  });
  assert.match(disclosed, /unavailable for capture/, "the disclosure copy ships in the email body");
  assert.match(disclosed, /Your site today/, "the panel keeps its place in the comparison");
  assert.doesNotMatch(disclosed, /Tap either one/, "copy never promises two tappable panels when one is a disclosure");

  const normal = composeOutreachEmailV2({
    businessName: "Gras Lawn Care",
    city: "Lakewood",
    previewUrl: MIRROR,
    beforeImage: "https://proof.wss-ai.com/old.jpg",
    afterImage: "https://proof.wss-ai.com/new.jpg",
  });
  assert.match(normal, /Your site today/);
  assert.doesNotMatch(normal, /unavailable for capture/, "a real before shot never carries the disclosure copy");
  assert.match(normal, /Tap either one/);

  // NO STATE AND NO IMAGE MEANS NO BLOCK — never an empty box, never a
  // disclosure the record cannot back up.
  const silent = composeOutreachEmailV2({
    businessName: "Gras Lawn Care",
    city: "Lakewood",
    previewUrl: MIRROR,
    afterImage: "https://proof.wss-ai.com/new.jpg",
  });
  assert.doesNotMatch(silent, /unavailable for capture/);
});

// ---------------------------------------------------------------------------
// 8. THE STATE HELPERS
// ---------------------------------------------------------------------------

test("the named-state helpers: record field to state string, tolerant parsing, never a guess", () => {
  assert.equal(beforeUnavailableStateOf({ before_unavailable: "http_403_forbidden" }), "before_unavailable:http_403_forbidden");
  assert.equal(beforeUnavailableStateOf({}), "");
  assert.equal(beforeUnavailableStateOf(null), "");

  assert.equal(namedBeforeUnavailable("before_unavailable:http_403_forbidden"), "before_unavailable:http_403_forbidden");
  assert.equal(namedBeforeUnavailable("http_403_forbidden"), "before_unavailable:http_403_forbidden");
  assert.equal(namedBeforeUnavailable("", "before_unavailable:challenge_page"), "before_unavailable:challenge_page");
  assert.equal(namedBeforeUnavailable("not a state!!"), "");
  assert.equal(namedBeforeUnavailable(), "");

  // The card copy is pinned too — it is the honest sentence the prospect reads.
  const card = placeholderCardHtml({ url: THEIR_SITE, mobile: false });
  assert.match(card, /unavailable for capture/);
  assert.match(card, /graslawn\.example/);
});
