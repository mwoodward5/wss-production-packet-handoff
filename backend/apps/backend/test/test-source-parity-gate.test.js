"use strict";

/**
 * test/test-source-parity-gate.test.js
 *
 * THE COMPARATIVE RELEASE GATE — "is this build at least as good as the
 * source site?"
 *
 * The nine render facts prove a mirror is CORRECT (honest, branded, its own
 * trade). Three more facts, added 2026-08-16 under the owner's corrected
 * factory contract, prove it is not WORSE than what the client already has:
 *
 *   · source_video_preserved  — a source hero/background video survives.
 *   · owned_photos_retained   — at least half the banked owned photos place,
 *                               or every unplaced one carries a reason.
 *   · side_by_side_captured   — the four before/after shots (source+build,
 *                               desktop+mobile) are on the record, supplied
 *                               as inputs or fail-closed on a rebuild.
 *
 * The fail-closed law under test: absent evidence a fact does not need is a
 * RECORDED skip (a reason, evidence saying null — never a bare pass), and
 * malformed or unprovable evidence is a refusal.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FACTS,
  evaluateRenderGate,
  assertGateIntegrity,
  checkSourceVideo,
  checkOwnedPhotos,
  checkSideBySide,
  functioningVideos,
  readRenderedDomOnce,
  RETENTION_FLOOR,
} = require("../lib/render-gate");
const { sourceFactsFor } = require("../lib/line-adapters");

// ---------------------------------------------------------------------------
// Fixtures — same shape as render-gate.test.js's clean Flint mirror.
// ---------------------------------------------------------------------------

function goodDom(overrides = {}) {
  return {
    ok: true,
    url: "https://wss-test-flint.wss-ai.com/",
    status: 200,
    title: "Flint Plumbing — Buda, TX",
    innerText:
      "Flint Plumbing\nServing Austin and the surrounding area\n" +
      "Call (512) 555-0147\n123 Main St, Buda, TX 78610\n" +
      "Drain cleaning, water heater replacement and sewer repair.\n" +
      "Licensed plumbing contractor.",
    hrefs: ["/services", "tel:+15125550147"],
    imgs: [],
    logos: [{ src: "https://cdn/flint.png", sha256: "a".repeat(64), width: 120, height: 40, bytes: 4096 }],
    jsonld: [{ "@type": "Plumber", name: "Flint Plumbing" }],
    ...overrides,
  };
}

function goodSource(overrides = {}) {
  return {
    prospect_id: "flint_1",
    business_name: "Flint Plumbing",
    vertical: "plumbing",
    phone: "512-555-0147",
    postal_city: "Buda",
    logo_sha256: "a".repeat(64),
    donor_strings: ["Premier Plumbing Co", "(214) 555-9900", "premierplumbing.example"],
    ...overrides,
  };
}

const HERO_VIDEO = { url: "https://clients-site.example.com/media/hero-loop.mp4", kind: "hero_background" };
const FUNCTIONING_BUILD_VIDEO = [{ src: "/assets/hero.mp4", poster: "/assets/hero-poster.jpg", readyState: 4, paused: false, inHero: true }];
const FOUR_SHOTS = {
  source_desktop: "https://proofs.example/shots/old.jpg",
  source_mobile: "https://proofs.example/shots/old-mobile.jpg",
  build_desktop: "https://proofs.example/shots/new.jpg",
  build_mobile: "https://proofs.example/shots/new-mobile.jpg",
};

// ---------------------------------------------------------------------------
// 0. The trio exists, fails closed blind, and leaves clean builds passing
// ---------------------------------------------------------------------------

test("the comparative facts are on the FACTS roll and the integrity self-check still passes", () => {
  for (const fact of ["source_video_preserved", "owned_photos_retained", "side_by_side_captured"]) {
    assert.ok(FACTS.includes(fact), `${fact} must be a release fact`);
  }
  assert.deepEqual(assertGateIntegrity(), { ok: true, facts: FACTS.length });
});

test("a blind gate fails ALL facts, the comparative trio included", () => {
  const verdict = evaluateRenderGate({ dom: { ok: false, reason: "chromium_launch_failed" }, source: goodSource() });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.failed.length, FACTS.length);
  for (const fact of ["source_video_preserved", "owned_photos_retained", "side_by_side_captured"]) {
    assert.ok(verdict.failed.includes(fact), `${fact} must fail when nothing was rendered`);
  }
});

test("a clean mirror with a packet that claims nothing comparative still passes every fact", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource() });
  assert.equal(verdict.pass, true, verdict.blockedBy);
  assert.equal(verdict.checks.length, FACTS.length);
  assert.deepEqual(verdict.failed, []);
});

test("every skip is RECORDED — absent comparative evidence passes with a reason and null evidence, never silently", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource() });
  const skips = verdict.checks.filter((c) => ["source_video_preserved", "owned_photos_retained", "side_by_side_captured"].includes(c.fact));
  for (const check of skips) {
    assert.equal(check.pass, true);
    assert.ok(String(check.reason).length > 10, "a skip must say why in words");
    assert.ok(check.evidence && typeof check.evidence === "object", "a skip must record what was absent");
  }
});

test("a LINE rebuild under the post-verdict hook passes shot-less — a hook-less rebuild still fails closed", () => {
  // Measured 2026-08-20 (fresh 10-site acceptance run): the line re-building
  // already-built prospects failed side_by_side_captured closed — for the
  // exact four shots its OWN post-verdict hook was about to take. The hook
  // runs for every line row, fresh or re-built, so the rebuild branch demands
  // input shots only on paths with no hook (api/admin/rebuild-mirror).
  const hooked = checkSideBySide({}, { rebuild: true, side_by_side_hook: "post_verdict" });
  assert.equal(hooked.pass, true, hooked.reason);
  assert.match(hooked.reason, /post-verdict hook/);
  assert.equal(hooked.evidence.rebuild, true, "the verdict still records that this replaced a build");

  const hookless = checkSideBySide({}, { rebuild: true });
  assert.equal(hookless.pass, false, "a rebuild with no hook and no shots is exactly the silent regression this fact stops");

  const wrongHook = checkSideBySide({}, { rebuild: true, side_by_side_hook: "someday" });
  assert.equal(wrongHook.pass, false, "only the declared post_verdict hook earns the grace");
});

test("EVERY line-runner gate evaluation declares the post-verdict hook — both lanes", () => {
  // Measured on the first ten-donor acceptance run (2026-08-20): the grace
  // had landed only in the batch loop while the DURABLE phase machine — the
  // lane every queued row actually rides — kept failing re-built prospects.
  // Both lanes store gateResult.capture, so both must declare the hook.
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "line-runner.js"), "utf8");
  const calls = [...src.matchAll(/sourceFacts\((?:row|batch\.rows\[i\]),\s*\{[\s\S]{0,700}?\}\s*\)/g)]
    // The deps doc block describes the signature in a comment; only real code
    // (a line not starting with `*`) is a call site.
    .filter((m) => !/^\s*\*/.test(src.slice(src.lastIndexOf("\n", m.index) + 1, m.index)));
  assert.ok(calls.length >= 2, `expected both line-runner sourceFacts call sites, found ${calls.length}`);
  for (const call of calls) {
    assert.match(call[0], /postVerdictCapture:\s*true/,
      `a line-runner gate evaluation without the hook declaration re-opens the side_by_side false refusal:\n${call[0].slice(0, 200)}`);
  }
});

// ---------------------------------------------------------------------------
// 1. VIDEO PARITY — source_video_preserved
// ---------------------------------------------------------------------------

test("video present on both sides passes", () => {
  const check = checkSourceVideo(goodDom({ videos: FUNCTIONING_BUILD_VIDEO, videoEmbeds: [] }), goodSource({ hero_video: HERO_VIDEO }));
  assert.equal(check.pass, true, check.reason);
  assert.equal(check.evidence.build_videos.native, 1);
  assert.equal(check.evidence.source_video.url, HERO_VIDEO.url);
});

test("a source hero video with NO functioning video in the build is a BLOCKER", () => {
  const check = checkSourceVideo(goodDom({ videos: [], videoEmbeds: [] }), goodSource({ hero_video: HERO_VIDEO }));
  assert.equal(check.pass, false);
  assert.match(check.reason, /hero\/background video/);
  assert.equal(check.evidence.build_videos, 0);
});

test("the whole gate refuses a build that lost the client's hero video", () => {
  const verdict = evaluateRenderGate({ dom: goodDom({ videos: [], videoEmbeds: [] }), source: goodSource({ hero_video: HERO_VIDEO }) });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failed.includes("source_video_preserved"));
  assert.match(verdict.blockedBy, /source_video_preserved/);
});

test("a dom whose video surface was never captured is UNPROVABLE, not video-free — fail closed", () => {
  const dom = goodDom();
  delete dom.videos;
  delete dom.videoEmbeds;
  const check = checkSourceVideo(dom, goodSource({ hero_video: HERO_VIDEO }));
  assert.equal(check.pass, false);
  assert.match(check.reason, /surface was not captured/);
});

test("video absent on the source side is a recorded skip — nothing to preserve", () => {
  const check = checkSourceVideo(goodDom({ videos: [], videoEmbeds: [] }), goodSource());
  assert.equal(check.pass, true);
  assert.match(check.reason, /nothing to preserve/);
  assert.equal(check.evidence.source_video, null);
});

test("video absent on the source but present in the build passes — donors may ship a cinematic hero", () => {
  const check = checkSourceVideo(goodDom({ videos: FUNCTIONING_BUILD_VIDEO }), goodSource());
  assert.equal(check.pass, true);
});

test("malformed source hero-video evidence (a bare string) is a refusal", () => {
  const check = checkSourceVideo(goodDom(), goodSource({ hero_video: "https://clients-site.example.com/hero.mp4" }));
  assert.equal(check.pass, false);
  assert.match(check.reason, /malformed/);
});

test("malformed source hero-video evidence (an object with no url) is a refusal", () => {
  const check = checkSourceVideo(goodDom(), goodSource({ hero_video: { kind: "hero_background" } }));
  assert.equal(check.pass, false);
  assert.match(check.reason, /malformed/);
});

test("a YouTube embed the visitor can play counts as a functioning video", () => {
  const check = checkSourceVideo(
    goodDom({ videos: [], videoEmbeds: ["https://www.youtube.com/embed/abc123"] }),
    goodSource({ hero_video: { url: "https://www.youtube.com/watch?v=abc123", kind: "hero" } }),
  );
  assert.equal(check.pass, true, check.reason);
  assert.equal(check.evidence.build_videos.embeds, 1);
});

test("a data: URI placeholder is not a functioning video", () => {
  const check = checkSourceVideo(
    goodDom({ videos: [{ src: "data:image/png;base64,AAAA", readyState: 0, paused: true }], videoEmbeds: [] }),
    goodSource({ hero_video: HERO_VIDEO }),
  );
  assert.equal(check.pass, false);
});

test("functioningVideos only counts real URLs — native and embed", () => {
  const found = functioningVideos({
    videos: [{ src: "/assets/hero.mp4" }, { src: "data:text/plain,x" }, { src: "" }, "not-an-object"],
    videoEmbeds: ["https://player.vimeo.com/video/42", "javascript:alert(1)"],
  });
  assert.deepEqual(found.native, ["/assets/hero.mp4"]);
  assert.deepEqual(found.embeds, ["https://player.vimeo.com/video/42"]);
});

test("the rendered-DOM reader actually captures the video surface (build-side wiring)", async () => {
  const browser = {
    async newPage() {
      return {
        async goto() { return { status: () => 200 }; },
        async evaluate() {
          return {
            title: "Flint Plumbing",
            innerText: "Flint Plumbing\nCall (512) 555-0147\nDrain cleaning and sewer repair in Buda, TX.",
            donorText: "",
            hrefs: [],
            imgs: [],
            videos: FUNCTIONING_BUILD_VIDEO,
            videoEmbeds: [],
            placeNames: [],
            jsonldRaw: [],
          };
        },
        request: { async get() { return { ok: () => false }; } },
        async close() {},
      };
    },
    async close() {},
  };
  const dom = await readRenderedDomOnce("https://wss-test-flint.wss-ai.com/", { launcher: { launch: async () => browser } });
  assert.equal(dom.ok, true, dom.reason);
  assert.deepEqual(dom.videos, FUNCTIONING_BUILD_VIDEO);
  assert.deepEqual(dom.videoEmbeds, []);
});

// ---------------------------------------------------------------------------
// 2. ASSET RETENTION ACCOUNTING — owned_photos_retained
// ---------------------------------------------------------------------------

test(`the retention floor is exactly ceil(captured * ${RETENTION_FLOOR}) — 16 captured needs 8 placed`, () => {
  assert.equal(checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16, photos_placed: 8 })).pass, true, "16/8 is the pass boundary");
  assert.equal(checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16, photos_placed: 7 })).pass, false, "16/7 is below the floor");
});

test("boundary at the small end — 4 captured needs exactly 2 placed, 5 needs 3", () => {
  assert.equal(checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 4, photos_placed: 2 })).pass, true);
  assert.equal(checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 5, photos_placed: 2 })).pass, false);
});

test("the owner's exact case — 16 banked, 2 placed, no reasons — BLOCKS the whole gate", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource({ photos_captured: 16, photos_placed: 2 }) });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failed.includes("owned_photos_retained"));
  const check = verdict.checks.find((c) => c.fact === "owned_photos_retained");
  assert.equal(check.evidence.captured, 16);
  assert.equal(check.evidence.placed, 2);
  assert.equal(check.evidence.required, 8);
  assert.equal(check.evidence.gap, 6);
});

test("per-asset rejection reasons covering the gap pass the row", () => {
  const reasons = Array.from({ length: 6 }, (_, i) => ({ url: `https://client.example/photo-${i}.jpg`, reason: `donor_slot_capacity:${i}` }));
  const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16, photos_placed: 2, photos_unplaced: reasons }));
  assert.equal(check.pass, true, check.reason);
  assert.equal(check.evidence.gap, 6);
  assert.equal(check.evidence.unplaced_reasons.length, 6);
});

test("reasons that do not COVER the gap still fail", () => {
  const reasons = Array.from({ length: 3 }, (_, i) => ({ url: `https://client.example/photo-${i}.jpg`, reason: "dead_slot" }));
  const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16, photos_placed: 2, photos_unplaced: reasons }));
  assert.equal(check.pass, false);
  assert.equal(check.evidence.unplaced_reasons, 3);
});

test("malformed rejection reasons (a string, not a list) cover nothing — fail closed", () => {
  const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16, photos_placed: 2, photos_unplaced: "donor only has two slots" }));
  assert.equal(check.pass, false);
  assert.equal(check.evidence.malformed_unplaced, true);
});

test("captured but no placed accounting on the build side is UNPROVABLE — fail closed", () => {
  const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16 }));
  assert.equal(check.pass, false);
  assert.match(check.reason, /unprovable/);
  assert.equal(check.evidence.placed, null);
});

test("zero usable owned photos captured is an honest pass — nothing to retain", () => {
  const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 0, photos_placed: 0 }));
  assert.equal(check.pass, true);
});

test("no owned-photo accounting on the packet is a RECORDED skip, not a pass claim", () => {
  const check = checkOwnedPhotos(goodDom(), goodSource());
  assert.equal(check.pass, true);
  assert.match(check.reason, /no owned-photo accounting/);
  assert.equal(check.evidence.captured, null);
  assert.equal(check.evidence.placed, null);
});

test("malformed captured counts are refusals, never coerced", () => {
  for (const bad of ["many", -3, 2.5, { count: 16 }]) {
    const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: bad }));
    assert.equal(check.pass, false, `photos_captured=${JSON.stringify(bad)} must refuse`);
    assert.match(check.reason, /malformed/);
  }
});

test("malformed placed counts are refusals, never coerced", () => {
  for (const bad of ["two", -1, 1.5]) {
    const check = checkOwnedPhotos(goodDom(), goodSource({ photos_captured: 16, photos_placed: bad }));
    assert.equal(check.pass, false, `photos_placed=${JSON.stringify(bad)} must refuse`);
    assert.match(check.reason, /malformed/);
  }
});

// ---------------------------------------------------------------------------
// 3. COMPARATIVE SHOTS — side_by_side_captured
// ---------------------------------------------------------------------------

test("four supplied shot URLs pass and land in the evidence verbatim", () => {
  const check = checkSideBySide(goodDom(), goodSource({ side_by_side_shots: FOUR_SHOTS }));
  assert.equal(check.pass, true, check.reason);
  assert.equal(check.evidence.source_desktop, FOUR_SHOTS.source_desktop);
  assert.equal(check.evidence.source_mobile, FOUR_SHOTS.source_mobile);
  assert.equal(check.evidence.build_desktop, FOUR_SHOTS.build_desktop);
  assert.equal(check.evidence.build_mobile, FOUR_SHOTS.build_mobile);
});

test("a REBUILD with no shots supplied fails closed", () => {
  const check = checkSideBySide(goodDom(), goodSource({ rebuild: true }));
  assert.equal(check.pass, false);
  assert.match(check.reason, /rebuild job/);
  assert.equal(check.evidence.shots, null);
});

test("a rebuild WITH all four shots passes", () => {
  const check = checkSideBySide(goodDom(), goodSource({ rebuild: true, side_by_side_shots: FOUR_SHOTS }));
  assert.equal(check.pass, true, check.reason);
});

test("a fresh build with no shots supplied is a recorded skip — capture rides the post-verdict hook", () => {
  const check = checkSideBySide(goodDom(), goodSource());
  assert.equal(check.pass, true);
  assert.match(check.reason, /post-verdict proof-shot hook/);
  assert.equal(check.evidence.shots, null);
  assert.equal(check.evidence.rebuild, false);
});

test("a partial shot set is a refusal — the fact names all four", () => {
  const check = checkSideBySide(goodDom(), goodSource({
    side_by_side_shots: { ...FOUR_SHOTS, build_mobile: "" },
  }));
  assert.equal(check.pass, false);
  assert.deepEqual(check.evidence.missing, ["build_mobile"]);
});

test("malformed shot evidence (an array, an object of non-urls) is a refusal", () => {
  assert.equal(checkSideBySide(goodDom(), goodSource({ side_by_side_shots: [FOUR_SHOTS.source_desktop] })).pass, false);
  assert.equal(checkSideBySide(goodDom(), goodSource({ side_by_side_shots: { source_desktop: 7 } })).pass, false);
});

test("the whole gate blocks a rebuild that lost its comparative record", () => {
  const verdict = evaluateRenderGate({ dom: goodDom(), source: goodSource({ rebuild: true }) });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.failed.includes("side_by_side_captured"));
});

// ---------------------------------------------------------------------------
// 4. The wiring — sourceFactsFor emits the packet's comparative evidence
// ---------------------------------------------------------------------------

function bankedRow({ photos = 16, harvestedAt = new Date().toISOString(), previewUrl = "" } = {}) {
  return {
    prospect_id: "flint_1",
    business_name: "Flint Plumbing",
    preview_url: previewUrl,
    record: {
      facts: { business_name: "Flint Plumbing", phone: "512-555-0147", city: "Buda" },
      logo_sha256: "a".repeat(64),
      donor_strings: ["Premier Plumbing Co", "(214) 555-9900", "premierplumbing.example"],
      build_ready: {
        photo_bank: {
          harvested_at: harvestedAt,
          website: "https://clients-site.example.com/",
          photos: Array.from({ length: photos }, (_, i) => ({
            url: `https://clients-site.example.com/work-${i}.jpg`,
            sha256: `${String(i).padStart(64, "0")}`,
            grade: i === 0 ? "hero" : "gallery",
          })),
        },
      },
    },
  };
}

function selectReturning(row) {
  return async () => ({ ok: true, data: [row] });
}

test("sourceFactsFor emits photos_captured from the record's FRESH photo bank", async () => {
  const out = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning(bankedRow({ photos: 16 })),
  });
  assert.equal(out.photos_captured, 16);
  assert.notEqual(out.rebuild, true, "no preview_url on the row — this is a fresh build");
});

test("sourceFactsFor emits photos_placed from the build's own accounting", async () => {
  const out = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning(bankedRow({ photos: 16 })),
    photoAccounting: { supplied: 8, usable: 8, placed: 2, unplaced: 6 },
  });
  assert.equal(out.photos_placed, 2);
});

test("a STALE bank emits no captured count — the gate records the skip instead of trusting old evidence", async () => {
  const stale = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const out = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning(bankedRow({ photos: 16, harvestedAt: stale })),
  });
  assert.equal(out.photos_captured, undefined);
});

test("a row that already carries a preview_url is flagged as a REBUILD", async () => {
  const out = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning(bankedRow({ previewUrl: "https://wss-test-flint.wss-ai.com/" })),
  });
  assert.equal(out.rebuild, true);
});

test("a record with no bank at all emits nothing — absent beats invented", async () => {
  const out = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning({ prospect_id: "flint_1", record: { facts: { business_name: "Flint Plumbing" } } }),
  });
  assert.equal(out.photos_captured, undefined);
  assert.equal(out.photos_placed, undefined);
});

test("END TO END: a banked packet plus a 2-of-16 build fails the gate on the retention fact", async () => {
  const source = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning(bankedRow({ photos: 16 })),
    photoAccounting: { supplied: 8, usable: 8, placed: 2, unplaced: 6 },
  });
  const verdict = evaluateRenderGate({ dom: goodDom(), source: { ...source, prospect_id: "flint_1" } });
  assert.equal(verdict.pass, false, "16 banked / 2 placed with no per-asset reasons must block");
  assert.ok(verdict.failed.includes("owned_photos_retained"));
});

test("END TO END: a banked packet plus an at-floor build passes every fact", async () => {
  const source = await sourceFactsFor({ prospectId: "flint_1", businessName: "Flint Plumbing", vertical: "plumbing" }, {
    select: selectReturning(bankedRow({ photos: 16 })),
    photoAccounting: { supplied: 8, usable: 8, placed: 8, unplaced: 0 },
  });
  const verdict = evaluateRenderGate({ dom: goodDom(), source: { ...source, prospect_id: "flint_1" } });
  assert.equal(verdict.pass, true, verdict.blockedBy);
});
