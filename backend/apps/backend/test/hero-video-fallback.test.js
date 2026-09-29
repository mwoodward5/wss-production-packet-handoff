"use strict";

// test/hero-video-fallback.test.js
//
// Pins DEFECT 2 of the 2026-09-02 Comet fleet audit: the initial screenshot
// pass measured a FULLY BLACK viewport on load — content present in the DOM
// but never painted — consistent with a hero <video> whose source failed and
// whose element kept painting over the page instead of yielding to the
// design's own hero image/color.
//
// The contract every hero-video donor must now satisfy:
//   1. PAINT-UNDER. The marked video carries a poster and a CSS background
//      (the site's own hero photograph/color) so a failed or slow load shows
//      the hero image — never black.
//   2. GRACEFUL DEATH. On a video error the element is hidden (the ladder
//      steps down rungs with the element hidden; the exhausted ladder hides
//      it outright), and `hidden` means display:none even where a donor
//      preflight resets `video { display: block }`.
//   3. THE ENGINE NET. finalizeHeroArtifact stamps every page that declares a
//      ladder with the fail-safe CSS + a last-resort error listener, whatever
//      the donor's own walker manages.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS = [
  "concrete-elconstruction", "electrical-livewire", "fencing-sterling", "hvac-brandforge",
  "landscaping-evergreen", "medspa-luma", "plumbing-clean", "plumbing-premier",
  "realestate-waterline", "roofing-falcon-clean", "salon-lacquer-studio",
];

const read = (...parts) => fs.readFileSync(path.join(BACKEND, ...parts), "utf8");
// ESM donor chunks are stored as `.js.raw` (a Vercel builder workaround) and
// renamed to `.js` at build time, so accept either.
const bundleName = (donor) => {
  const dir = path.join(BACKEND, "donors-clean", donor, "assets");
  const files = fs.readdirSync(dir);
  return files.find((f) => /^index-.*\.js$/.test(f)) || files.find((f) => /^index-.*\.js\.raw$/.test(f));
};

test("every ladder donor's walker treats an exhausted ladder as terminal (hide, never leave in play)", () => {
  for (const donor of DONORS) {
    const html = read("donors-clean", donor, "index.html");
    assert.match(
      html,
      /if\(!src\)\{clip\.setAttribute\("data-hero-dead","1"\);clip\.hidden=true;/,
      `${donor}: the walker still returns on an exhausted ladder without hiding the video`,
    );
    assert.match(
      html,
      /clip\.addEventListener\("error",function\(\)\{clip\.setAttribute\("data-hero-dead","1"\);clip\.hidden=true;/,
      `${donor}: the walker does not hide the video while stepping down a failed rung`,
    );
    assert.match(
      html,
      /clip\.removeAttribute\("data-hero-dead"\)/,
      `${donor}: an armed rung does not clear the dead flag left by a failed one`,
    );
  }
});

test("every ladder donor ships the kill-switch CSS and a paint-under surface on the marked video", () => {
  for (const donor of DONORS) {
    const html = read("donors-clean", donor, "index.html");
    assert.match(
      html,
      /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/,
      `${donor}: the hidden attribute is not enforced against video{display:block} preflights`,
    );
    assert.match(
      html,
      /video\[data-hero-video\]\[data-hero-dead\]\s*\{\s*display:\s*none !important;\s*\}/,
      `${donor}: a video that failed every rung is not display:none`,
    );
    // Paint-under: plumbing-clean carries its own rule in its head style block
    // (with the reduced-motion guard); every other donor ships the
    // data-wss-hero-fallback block with a background surface.
    const hasOwnOrFallback =
      /video\[data-hero-video\]\s*\{\s*background:/.test(html) || html.includes("data-wss-hero-fallback");
    assert.ok(hasOwnOrFallback, `${donor}: the marked video has no CSS background surface to paint under a failed load`);
  }
});

test("ladder-donor bundles mount the marked video hidden with a poster (the always-painted rung)", () => {
  // fencing-sterling and medspa-luma ship no raster to poster (their heroes
  // paint via the CSS surface from the fallback style block); hvac-brandforge
  // conditionally mounts EITHER the video (usable) or its poster image
  // (not usable) through React state, so its video carries no hidden attr.
  // Every other donor's bundle must mount the marked video hidden, with a
  // poster.
  const NO_POSTER = new Set(["fencing-sterling", "medspa-luma"]);
  const NO_HIDDEN = new Set(["hvac-brandforge"]);
  for (const donor of DONORS) {
    const js = read("donors-clean", donor, "assets", bundleName(donor));
    const at = js.indexOf('"data-hero-video"');
    assert.ok(at >= 0, `${donor}: no marked hero video element in the bundle`);
    const frag = js.slice(Math.max(0, at - 60), at + 430);
    if (!NO_HIDDEN.has(donor)) {
      assert.match(frag, /hidden:!0/, `${donor}: the hero video must mount hidden`);
    }
    if (!NO_POSTER.has(donor)) {
      assert.match(frag, /poster:/, `${donor}: the hero video must carry a poster`);
    }
  }
});

test("general-contractor-clean: static hero video honors hidden/dead despite the img,video display reset", () => {
  const main = read("donors-clean", "general-contractor-clean", "assets", "main.js");
  assert.match(main, /if \(!source\) \{[\s\S]*?video\.setAttribute\("data-hero-dead", "1"\);[\s\S]*?video\.hidden = true;/,
    "the exhausted ladder must mark the video dead and hide it");
  assert.match(main, /var onError = function \(\) \{[\s\S]*?video\.setAttribute\("data-hero-dead", "1"\);[\s\S]*?video\.hidden = true;/,
    "a failed rung must be stepped down with the video hidden");
  const css = read("donors-clean", "general-contractor-clean", "assets", "styles.css");
  assert.match(css, /video\[data-hero-video\]\[hidden\] \{ display: none !important; \}/,
    "styles.css resets img,video display:block — hidden must be re-enforced");
  assert.match(css, /video\[data-hero-video\]\[data-hero-dead\] \{ display: none !important; \}/);
});

test("engine: every ladder page gets the fail-safe net — and only ladder pages do", () => {
  process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "mirror-clients-hero-fallback-"));
  const { finalizeHeroArtifact } = require("../lib/mirror-engine/engine");

  const ladderPage = '<html><head><title>t</title></head><body><script id="hero-video-ladder" type="application/json">{"sources":[]}</script></body></html>';
  const plainPage = "<html><body>plain</body></html>";
  const files = {
    "index.html": Buffer.from(ladderPage),
    "about/index.html": Buffer.from(plainPage),
  };
  const report = finalizeHeroArtifact({
    files,
    manifest: { hero_video: { wss_fallback_clip_path: "assets/hero-fallback.mp4" } },
    heroVideoSlot: "",
    heroVideoPlaced: 0,
    heroVideoProvenance: null,
  });

  const stamped = files["index.html"].toString("utf8");
  assert.ok(stamped.includes("data-wss-hero-failsafe"), "the ladder page ships without the fail-safe net");
  assert.match(stamped, /video\[data-hero-video\]\[data-hero-dead\]\{display:none!important\}/);
  assert.match(stamped, /tagName!=="VIDEO"/, "the last-resort video error listener is missing");
  assert.equal(files["about/index.html"].toString("utf8"), plainPage, "a page without a ladder was stamped anyway");
  assert.equal(report.failsafe_pages, 1, "the report must count the fail-safe stamps");

  // Idempotent: a rebuild must not stack nets.
  finalizeHeroArtifact({
    files,
    manifest: { hero_video: { wss_fallback_clip_path: "assets/hero-fallback.mp4" } },
    heroVideoSlot: "",
    heroVideoPlaced: 0,
    heroVideoProvenance: null,
  });
  assert.equal((files["index.html"].toString("utf8").match(/data-wss-hero-failsafe/g) || []).length, 2,
    "the fail-safe must stamp once (one style + one script attribute), not per rebuild");
});
