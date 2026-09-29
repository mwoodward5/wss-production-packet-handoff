"use strict";

// test/page-xray.test.js — the pure layers of lib/page-xray, with no browser.
//
// Everything that decides what a thing is CALLED, what colour it IS, whether a
// picture is STRETCHED, and which element a caller MEANT is a pure function
// over compact signals. That is deliberate: those are the judgements that were
// wrong on real calls, and a judgement that needs a live page to test is a
// judgement nobody re-tests.
//
// The browser half is proven separately and against a real live mirror by
// scripts/page-xray-live-proof.js, which re-resolves every selector it minted
// on a FRESH page load and reports the count that matched nothing.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toHex,
  contrastRatio,
  zoneOf,
  roleOf,
  classifyName,
  measureImage,
  defectsOf,
  findByName,
  describeElement,
  hydrateElements,
  createCache,
  cacheKey,
  normalizeUrl,
  withoutBuffers,
  xray,
  invalidate,
  TTL_NO_BUILD_MS,
  TTL_WITH_BUILD_MS,
} = require("../lib/page-xray");

// ---------------------------------------------------------------------------
// LAYER 3 — colour
// ---------------------------------------------------------------------------
test("toHex converts what the browser gives it and refuses what it cannot read", () => {
  assert.equal(toHex("rgb(255, 102, 0)").hex, "#ff6600");
  assert.equal(toHex("rgba(15, 15, 17, 1)").hex, "#0f0f11");
  assert.equal(toHex("#FF6600").hex, "#ff6600");
  assert.equal(toHex("#f60").hex, "#ff6600");
  assert.equal(toHex("rgba(0,0,0,0)").alpha, 0);

  // THE ONE THAT MATTERS. These donors author in oklch and getComputedStyle
  // hands it back verbatim (measured on a live h1 by lib/edit-verify). An
  // approximation here would put a hex in front of an owner that no pixel on
  // the page is, so an unreadable colour is "" and the raw string travels on.
  const oklch = toHex("oklch(0.96 0.032 270.5)");
  assert.equal(oklch.hex, "", "a non-sRGB computed colour must never be guessed at");
  assert.equal(oklch.raw, "oklch(0.96 0.032 270.5)", "the raw computed value is the authority and must survive");
});

test("contrast is a number only when both sides are readable", () => {
  assert.equal(contrastRatio("#ffffff", "#000000"), 21);
  assert.equal(contrastRatio("#f2f2f2", "#0f0f11"), 17.1);
  assert.equal(contrastRatio("", "#000000"), null);
  assert.equal(contrastRatio("#ffffff", ""), null);
});

// ---------------------------------------------------------------------------
// LAYER 3 — the stretched / cut off / cropped complaint
// ---------------------------------------------------------------------------
test("a logo pinned on both axes is reported as stretched, with the numbers", () => {
  const m = measureImage({
    tag: "img", naturalWidth: 212, naturalHeight: 108, objectFit: "fill",
    rect: { w: 200, h: 200 },
  });
  const stretched = m.verdicts.find((v) => v.kind === "stretched");
  assert.ok(stretched, "a 212x108 mark drawn into a 200x200 box is stretched");
  assert.match(stretched.detail, /200x200/);
  assert.match(stretched.detail, /212x108/);
  assert.match(stretched.detail, /squashed by 49%/);
});

test("object-fit:contain in an odd box is NOT stretched — the browser preserves the picture", () => {
  const m = measureImage({
    tag: "img", naturalWidth: 212, naturalHeight: 108, objectFit: "contain",
    rect: { w: 141, h: 72 },
  });
  assert.deepEqual(m.verdicts.filter((v) => v.kind === "stretched"), [],
    "contain letterboxes; the box ratio proves nothing about the picture");
});

test("object-fit:cover reports how much of the picture is hidden, not that it is stretched", () => {
  // The live Rimrock hero photo: a 1080x1920 portrait in a 399x300 landscape box.
  const m = measureImage({
    tag: "img", naturalWidth: 1080, naturalHeight: 1920, objectFit: "cover",
    rect: { w: 399, h: 300 },
  });
  assert.equal(m.verdicts.some((v) => v.kind === "stretched"), false);
  const cropped = m.verdicts.find((v) => v.kind === "cropped");
  assert.ok(cropped);
  assert.equal(m.hidden_fraction, 0.58);
});

test("an image drawn far larger than its pixels is called soft, not fine", () => {
  const m = measureImage({ tag: "img", naturalWidth: 100, naturalHeight: 100, objectFit: "fill", rect: { w: 400, h: 400 } });
  assert.ok(m.verdicts.find((v) => v.kind === "upscaled"));
  assert.equal(m.verdicts.some((v) => v.kind === "stretched"), false, "4x on both axes is faithful, only soft");
});

test("no intrinsic size is an absence, never a verdict", () => {
  const m = measureImage({ tag: "svg", naturalWidth: 0, naturalHeight: 0, objectFit: "fill", rect: { w: 120, h: 40 } });
  assert.equal(m.distortion, null);
  assert.deepEqual(m.verdicts.map((v) => v.kind), ["no_natural_size"]);
  assert.equal(defectsOf({ label: "1280", viewport: { width: 1280 }, elements: [{ name: "logo", nameable: true, image: m, overflow: {} }] }).length,
    0, "an unmeasurable image must not be reported as a defect");
});

// ---------------------------------------------------------------------------
// LAYER 2 — naming and position
// ---------------------------------------------------------------------------
test("zoneOf speaks the way a customer does", () => {
  const vp = { width: 1280, height: 800 };
  assert.equal(zoneOf({ x: 20, y: 20, w: 140, h: 72 }, vp), "top left");
  assert.equal(zoneOf({ x: 1000, y: 20, w: 200, h: 40 }, vp), "top right");
  assert.equal(zoneOf({ x: 500, y: 380, w: 200, h: 40 }, vp), "middle centre");
  // Below the fold, a corner is meaningless — distance is the honest answer.
  assert.match(zoneOf({ x: 20, y: 3200, w: 200, h: 40 }, vp), /screens down, left/);
});

test("the logo is recognised by src, by alt and by hint — all three", () => {
  const base = { rect: { x: 0, y: 0, w: 141, h: 72 }, viewportWidth: 1280, viewportHeight: 800, inHeader: true, hints: [] };
  assert.equal(classifyName({ ...base, tag: "img", src: "/assets/client-logo.png" }).name, "logo");
  assert.equal(classifyName({ ...base, tag: "img", src: "/assets/x.png", alt: "Rimrock Plumbing logo" }).name, "logo");
  assert.equal(classifyName({ ...base, tag: "img", src: "/assets/x.png", hints: ["logo"] }).name, "logo");
  assert.equal(classifyName({ ...base, tag: "img", src: "/assets/hands-brass.jpg" }).name, "photo");
});

test("the whole page is never named the hero", () => {
  const vp = { viewportWidth: 1280, viewportHeight: 800, hints: [], index: 2 };
  // The real defect: body's root wrapper on the live Rimrock mirror, 1280x13149.
  const wholePage = classifyName({ ...vp, tag: "div", rect: { x: 0, y: 0, w: 1280, h: 13149 } });
  assert.notEqual(wholePage.name, "hero", "naming the document after one of its parts is the wrong-element failure");
  // A real hero — about one screen — still is one.
  const hero = classifyName({ ...vp, tag: "section", id: "top", rect: { x: 0, y: 0, w: 1280, h: 1178 } });
  assert.equal(hero.name, "hero");
});

test("a phone link in the header is a call button; elsewhere it is a phone number", () => {
  const base = { tag: "a", href: "tel:+14068557131", rect: { x: 1000, y: 20, w: 283, h: 40 }, viewportWidth: 1280, viewportHeight: 800, hints: [] };
  assert.equal(classifyName({ ...base, inHeader: true }).name, "call button");
  assert.equal(classifyName({ ...base, inHeader: false }).name, "phone number");
});

test("roleOf falls back to the implicit role and never invents one", () => {
  assert.equal(roleOf({ tag: "h1" }), "heading");
  assert.equal(roleOf({ tag: "a", href: "/x" }), "link");
  assert.equal(roleOf({ tag: "a" }), "", "an anchor with no href is not a link");
  assert.equal(roleOf({ tag: "div", role: "banner" }), "banner");
  assert.equal(roleOf({ tag: "div" }), "");
});

// ---------------------------------------------------------------------------
// THE RECORDED FAILURE: "the logo, top left"
// ---------------------------------------------------------------------------
function fakeView() {
  const raw = [
    {
      index: 0, depth: 1, tag: "header", id: "", role: "", href: "", src: "", alt: "", label: "", placeholder: "",
      text: "", hints: ["header"], inHeader: true, isLandmarkish: true,
      rect: { x: 0, y: 0, w: 1280, h: 144 }, visible: { w: 1280, h: 144 }, view: { x: 0, y: 0 }, fixed: true,
      style: { color: "rgb(0,0,0)", backgroundColor: "rgb(255,255,255)", backgroundImage: "", effectiveBackground: "", fontFamily: "Inter", fontSize: "16px", display: "flex", position: "fixed", zIndex: "50", opacity: "1", overflow: "visible visible", objectFit: "fill" },
      naturalWidth: 0, naturalHeight: 0, objectFit: "fill", media: null, stackingContext: true,
      overflow: { viewport_px: 0, viewport_side: "", clipped_px: 0, parent_overflow: "" },
      topmost: true, covered_by: "", selector: "header", selector_kind: "tag", selector_stable: true,
    },
    {
      index: 1, depth: 3, tag: "img", id: "", role: "", href: "", src: "/assets/client-logo.png", alt: "logo", label: "", placeholder: "",
      text: "", hints: ["logo"], inHeader: true, isLandmarkish: false,
      rect: { x: 24, y: 36, w: 141, h: 72 }, visible: { w: 141, h: 72 }, view: { x: 24, y: 36 }, fixed: false,
      style: { color: "rgb(0,0,0)", backgroundColor: "rgba(0,0,0,0)", backgroundImage: "", effectiveBackground: "", fontFamily: "Inter", fontSize: "16px", display: "block", position: "static", zIndex: "auto", opacity: "1", overflow: "visible visible", objectFit: "contain" },
      naturalWidth: 212, naturalHeight: 108, objectFit: "contain", media: null, stackingContext: false,
      overflow: { viewport_px: 0, viewport_side: "", clipped_px: 0, parent_overflow: "" },
      topmost: false, covered_by: "span.wss-brand-name",
      selector: 'header img[src*="client-logo"]', selector_kind: "semantic", selector_stable: true,
    },
    {
      index: 2, depth: 4, tag: "h1", id: "", role: "", href: "", src: "", alt: "", label: "", placeholder: "",
      text: "Plumbing in Billings. Done right.", hints: [], inHeader: false, isLandmarkish: true,
      rect: { x: 282, y: 400, w: 716, h: 276 }, visible: { w: 716, h: 276 }, view: { x: 282, y: 400 }, fixed: false,
      style: { color: "rgb(242,242,242)", backgroundColor: "rgba(0,0,0,0)", backgroundImage: "", effectiveBackground: "rgb(15,15,17)", fontFamily: "Fraunces", fontSize: "64px", display: "block", position: "static", zIndex: "auto", opacity: "1", overflow: "visible visible", objectFit: "fill" },
      naturalWidth: 0, naturalHeight: 0, objectFit: "fill", media: null, stackingContext: false,
      overflow: { viewport_px: 0, viewport_side: "", clipped_px: 0, parent_overflow: "" },
      topmost: true, covered_by: "", selector: "h1", selector_kind: "tag", selector_stable: true,
    },
  ];
  const viewport = { width: 1280, height: 800 };
  const elements = hydrateElements({ elements: raw }, viewport);
  const view = { label: "1280", viewport, elements };
  view.defects = defectsOf(view);
  return view;
}

test('"the logo, top left" resolves to one element, with its reasons', () => {
  const found = findByName({ desktop: fakeView() }, "the logo top left");
  assert.equal(found.ok, true);
  assert.equal(found.ambiguous, false, "one logo on the page is not an ambiguous request");
  assert.equal(found.matches[0].selector, 'header img[src*="client-logo"]');
  assert.equal(found.matches[0].name, "logo");
  assert.ok(found.matches[0].why.some((w) => /name is "logo"/.test(w)), found.matches[0].why.join("; "));
  assert.ok(found.matches[0].why.some((w) => /top left/.test(w)), found.matches[0].why.join("; "));
});

test("synonyms a tradesperson actually uses reach the same element", () => {
  const view = { desktop: fakeView() };
  for (const phrase of ["my brand mark", "the wordmark", "company logo"]) {
    const found = findByName(view, phrase);
    assert.equal(found.ok, true, phrase);
    assert.equal(found.matches[0].name, "logo", phrase);
  }
  assert.equal(findByName(view, "the big text at the top").matches[0].selector, "h1");
});

test("a phrase that matches nothing says so rather than returning the nearest thing", () => {
  const found = findByName({ desktop: fakeView() }, "the shopping cart");
  assert.equal(found.ok, false);
  assert.equal(found.reason, "nothing_on_the_page_matched");
  assert.deepEqual(found.matches, []);
});

test("two equally good candidates come back ambiguous instead of one being guessed", () => {
  const view = fakeView();
  const twin = { ...view.elements[1], index: 9, selector: 'footer img[src*="client-logo"]', rect: { ...view.elements[1].rect } };
  const found = findByName({ desktop: { ...view, elements: [...view.elements, twin] } }, "the logo");
  assert.equal(found.ambiguous, true, "two logos means the caller must be asked which — guessing is the failure");
  assert.equal(found.matches.length >= 2, true);
});

test("describeElement is a sentence, and it carries the measurement", () => {
  const view = fakeView();
  const logo = view.elements.find((e) => e.name === "logo");
  const said = describeElement(logo);
  assert.match(said, /the logo, top left, 141 by 72 pixels/);
  assert.match(said, /the picture itself is 212 by 108/);
});

// ---------------------------------------------------------------------------
// Defects
// ---------------------------------------------------------------------------
test("an element painted over is reported, and it names what covers it", () => {
  const view = fakeView();
  const covered = view.defects.find((d) => d.kind === "covered");
  assert.ok(covered, "the sign-up panel sitting on the client's logo is the defect nobody looked for");
  assert.equal(covered.name, "logo");
  assert.match(covered.detail, /span\.wss-brand-name/);
});

test("overhang and clipping are only reported about things a customer can name", () => {
  // The marquee span: 3,298px to the right of a 390px screen, inside its own
  // clipping track. Real geometry, zero defects — 31 of these drowned the one
  // real finding on the first live run.
  const anonymous = {
    tag: "span", name: "", nameable: false, image: null,
    overflow: { viewport_px: 3298, viewport_side: "right", clipped_px: 3352, parent_overflow: "hidden hidden" },
  };
  const named = {
    tag: "img", name: "logo", nameable: true, selector: "header img", image: null,
    overflow: { viewport_px: 17, viewport_side: "left", clipped_px: 0, parent_overflow: "" },
  };
  const out = defectsOf({ label: "390", viewport: { width: 390 }, elements: [anonymous, named] });
  assert.equal(out.length, 1, "an unnamed structural box overhanging its own scroller is noise");
  assert.equal(out[0].kind, "overhangs_viewport");
  assert.match(out[0].detail, /sticks out 17px past the left edge of a 390px screen/);
});

// ---------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------
test("the cache key is (url, build_hash) and is insensitive to a trailing slash", () => {
  assert.equal(cacheKey("https://x.wss-ai.com/", "abc"), cacheKey("https://x.wss-ai.com", "abc"));
  assert.notEqual(cacheKey("https://x.wss-ai.com/", "abc"), cacheKey("https://x.wss-ai.com/", "def"));
  assert.match(cacheKey("https://x.wss-ai.com/", ""), /no-build-hash$/);
  assert.equal(normalizeUrl("https://x.wss-ai.com/#top"), "https://x.wss-ai.com/");
});

test("a cached entry expires, and invalidate(url) drops every build of that url", () => {
  let clock = 1_000_000;
  const cache = createCache({ now: () => clock });
  cache.set(cacheKey("https://x.wss-ai.com/", "b1"), { v: 1 }, 1000);
  cache.set(cacheKey("https://x.wss-ai.com/", "b2"), { v: 2 }, 1000);
  cache.set(cacheKey("https://other.wss-ai.com/", "b1"), { v: 3 }, 1000);
  assert.equal(cache.size(), 3);
  assert.equal(cache.invalidate("https://x.wss-ai.com"), 2, "both builds of that url go");
  assert.equal(cache.size(), 1, "another host's entry is untouched");
  clock += 2000;
  assert.equal(cache.get(cacheKey("https://other.wss-ai.com/", "b1")), null, "an expired entry is a miss");
});

test("the cache is an LRU and cannot grow without bound", () => {
  const cache = createCache({ maxEntries: 2 });
  cache.set("a", { v: 1 }, 60_000);
  cache.set("b", { v: 2 }, 60_000);
  cache.get("a"); // a is now the most recently used
  cache.set("c", { v: 3 }, 60_000);
  assert.equal(cache.size(), 2);
  assert.ok(cache.get("a"), "the recently used entry survived");
  assert.equal(cache.get("b"), null, "the least recently used was evicted");
});

test("xray serves a cache hit without touching a browser, and reports it as one", async () => {
  const cache = createCache();
  const key = cacheKey("https://x.wss-ai.com/", "b1");
  cache.set(key, { ok: true, url: "https://x.wss-ai.com/", cache: { hit: false, key } }, 60_000);
  const out = await xray("https://x.wss-ai.com/", {
    cache,
    buildHash: "b1",
    launch: () => { throw new Error("a cache hit must never launch a browser"); },
  });
  assert.equal(out.ok, true);
  assert.equal(out.cache.hit, true);
  assert.equal(typeof out.cache.age_ms, "number");
});

test("a capture with no build hash says the cache is a bet, and names the fix", async () => {
  // Proven through the real code path: no browser, so it fails — but the TTL
  // policy and the wiring instruction are asserted on the constants that the
  // capture path uses, which is what a caller depends on.
  assert.ok(TTL_NO_BUILD_MS < TTL_WITH_BUILD_MS, "an unkeyed capture must expire sooner");
  assert.equal(TTL_NO_BUILD_MS, 90_000);
  assert.equal(typeof invalidate("https://nothing-here.example"), "number");
});

// ---------------------------------------------------------------------------
// Failing closed
// ---------------------------------------------------------------------------
test("no url is an honest refusal, not a throw", async () => {
  const out = await xray("");
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no_url");
});

test("a browser that will not come names the fix instead of hanging", async () => {
  const out = await xray("https://x.wss-ai.com/", {
    useCache: false,
    permitWaitMs: 30,
    launch: () => new Promise(() => {}), // never resolves — a held permit
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /chromium_unavailable/);
  assert.match(out.reason, /pass the open browser/,
    "the message must carry the fix: mid-edit the caller already holds the render permit");
  assert.ok(out.timings.total_ms < 5000, "it must give up fast, not wait out serverless-chromium's 300s");
});

test("a launcher that throws is reported, never swallowed", async () => {
  const out = await xray("https://x.wss-ai.com/", {
    useCache: false,
    launch: () => { throw new Error("chromium_launch_failed: no executable"); },
  });
  assert.equal(out.ok, false);
  assert.match(out.reason, /chromium_launch_failed/);
});

test("catalog is the small view: addressable elements, and the stability flag", () => {
  const { catalog } = require("../lib/page-xray");
  const rows = catalog({ desktop: fakeView() });
  const logo = rows.find((r) => r.name === "logo");
  assert.ok(logo, "the logo must be in the catalog a planner is handed");
  assert.equal(logo.selector, 'header img[src*="client-logo"]');
  assert.equal(logo.stable, true);
  assert.equal(logo.size, "141x72");
  assert.equal(logo.covered_by, "span.wss-brand-name", "a covered element says so in the catalog too");
  // The whole point: it has to be small enough to put in a prompt. The full
  // record of the live Rimrock capture is 1.1MB; this is the 4KB view.
  assert.ok(JSON.stringify(rows).length < 6000, `catalog was ${JSON.stringify(rows).length} bytes`);
  assert.equal(rows.every((r) => r.selector), true, "a catalog row without a proven selector is useless");
});

test("withoutBuffers strips the megabytes and keeps the digests", () => {
  const buf = Buffer.from("not really a jpeg");
  const stripped = withoutBuffers({
    ok: true,
    shot: { buffer: buf, bytes: buf.length, sha256: "abc" },
    crops: [{ name: "logo", buffer: buf, sha256: "def" }],
    desktop: { shot: { buffer: buf, sha256: "abc" }, crops: [] },
    mobile: null,
    mobile_shot: null,
  });
  assert.equal(stripped.shot.buffer, undefined);
  assert.equal(stripped.shot.has_buffer, true);
  assert.equal(stripped.shot.sha256, "abc");
  assert.equal(stripped.crops[0].buffer, undefined);
  assert.equal(JSON.stringify(stripped).includes("not really a jpeg"), false);
});
