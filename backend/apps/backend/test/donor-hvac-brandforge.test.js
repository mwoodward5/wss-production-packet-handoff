"use strict";

// test/donor-hvac-brandforge.test.js
//
// THE HERO VIDEO CONTRACT (owner's order, 2026-08-16): every donor is a
// live-action video hero site on a documented ladder —
//
//   rung 1  the CLIENT's own clip          assets/hero-client-hvac.mp4
//   rung 2  a WSS-OWNED clip               assets/hero-video.mp4
//                                         (operations drop-in at the path
//                                         the hero layer always named; no
//                                         bytes ship today, so this rung
//         [                                 arms the day the clip lands —
//                                         with NO code change ]
//   rung 3  the still poster photograph    assets/hero-hvac-BowSuqa2.jpg —
//                                         the img branch and the video
//                                         poster attribute are one file
//   rung 4  the drawn hero composition     grain and gradient layers
//
// This donor is a React SPA whose hero layer pointed at assets/hero-video.mp4
// through a STATIC src on a file the donor does not ship: a guaranteed 404
// request on every page load, papered over by an onError flip to the still.
// The ladder graft removes the static src and the onError (one failed rung
// must not strand the ladder), marks the element data-hero-video, and lets
// the hero-video-ladder runtime arm rungs only when their bytes shipped.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "hvac-brandforge";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-brandforge-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Summit Air Care",
    CITY: "Akron", ADDRESS_CITY: "Akron", STATE: "OH", REGION: "OH",
    HERO_HEADLINE: "HVAC in Akron, OH",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(330) 555-0153", PHONE_DIGITS: "3305550153",
      EMAIL: "hello@example.com", ADDRESS: "1 Market St", ZIP: "44308", POSTAL: "44308",
      RATING: "4.7", REVIEW_COUNT: "41",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "41.0814", GEO_LNG: "-81.5190",
    });
  }
  return tv;
}

function bundleOf() {
  return fs.readFileSync(path.join(DIR, "assets", "index-BMZ4eaGZ.js"), "utf8");
}

/** The marked hero-video jsx fragment (the ternary's video arm only —
 *  the img arm that follows carries its own src, by design). */
function videoFragmentOf(js) {
  const marker = js.indexOf('jsx("video",{"data-hero-video"');
  if (marker < 0) return null;
  return js.slice(marker, js.indexOf("):x.jsx", marker) + 7);
}

function ladderOf(html) {
  const m = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function hydrateHtml(tv) {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tv });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);
  return out.files["index.html"].toString("utf8");
}

// ---------------------------------------------------------------------------
// 7. THE HERO VIDEO CONTRACT — the element, the ladder, and nothing that 404s
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: a full-autoplay <video>, no static src, over the poster rung", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = bundleOf();

  // The contract is declared in the manifest, and the rejected language is gone.
  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined,
    "the owner rejected the no-hero-video contract; the key must not come back");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4,
    "the documented fallback ladder (client video, WSS clip, still, drawn) must live in the manifest");

  // The <video> in the bundle carries the full autoplay contract, is marked
  // for the ladder runtime, and carries NO src of any kind.
  const video = videoFragmentOf(js);
  assert.ok(video, "no marked hero video element in the bundle — the ladder runtime has nothing to arm");
  for (const attr of ["autoPlay:!0", "muted:!0", "loop:!0", "playsInline:!0", 'preload:"metadata"', "poster:T0"]) {
    assert.ok(video.includes(attr), `the hero video must carry ${attr} (has: ${video})`);
  }
  assert.ok(!/\bsrc:/.test(video),
    "a static src is a guaranteed 404 until a clip ships — the runtime arms a rung only when its bytes exist");
  assert.ok(!video.includes("onError"),
    "the old onError flip to the still stranded the ladder after one failed rung — the runtime owns errors now");
  assert.ok(!js.includes('src:"/assets/hero-video.mp4"'),
    "the phantom clip reference must be gone from the bundle entirely — the donor ships no bytes at that path");

  // The poster is the first photo slot, and the still rung is the same file.
  assert.equal(m.photo_slots[0], m.hero_video.poster,
    "the poster must be the first photo slot, so a filled hero photo and the poster are the same image");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)));
  assert.ok(js.includes('T0="/assets/hero-hvac-BowSuqa2.jpg"'),
    "the poster variable must resolve to the declared poster file");

  // The ladder is data, not code — and the client's clip outranks ours.
  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "the hero-video-ladder JSON island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the ladder must walk the client's own video first, the WSS-owned clip second");

  // The runtime walk is present and guarded.
  assert.match(html, /getElementById\("hero-video-ladder"\)/, "the runtime must read the ladder island");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion must never arm the video rungs");
  assert.match(html, /video\[data-hero-video\]/, "the runtime must wait for the SPA-mounted hero video element");
});

// ---------------------------------------------------------------------------
// 8. The WSS rung is a DROP-IN: no bytes today; the day they land, they ship
//    — with NO code change
// ---------------------------------------------------------------------------
const FIXTURE_MP4 = path.join(BACKEND, "test", "fixtures", "mirror-donor", "media", "hero-loop.mp4");

function copyDonorTree(dest) {
  const walk = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const f = path.join(from, e.name);
      const t = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(t, { recursive: true }); walk(f, t); }
      else fs.copyFileSync(f, t);
    }
  };
  walk(DIR, dest);
  return dest;
}

test("the WSS fallback clip ships as real rung-2 bytes (added 2026-08-19)", () => {
  const m = manifest();
  // The declared client rung stays honestly EMPTY until a real client clip is
  // engine-placed; the WSS-owned fallback now ships real bytes, so the ladder
  // arms rung 2 on every build instead of falling to the still poster (the
  // missing files were the render gate's hero_video_not_playing refusals).
  assert.ok(!fs.existsSync(path.join(DIR, m.hero_video.client_video_path)),
    "the client rung must stay empty until the engine places a verified client clip");
  const clip = path.join(DIR, m.hero_video.wss_fallback_clip_path);
  assert.ok(fs.existsSync(clip), "the WSS fallback clip must ship");
  const bytes = fs.readFileSync(clip);
  assert.ok(bytes.length > 100000, `real clip bytes expected (${bytes.length})`);
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp", "must be a real mp4");
  const { files } = loadDonor(DIR);
  assert.ok(files[m.hero_video.wss_fallback_clip_path], "loadDonor ships the clip on every build");
});

test("a clip dropped at a documented rung path ships and keeps the rung order — no code change", () => {
  const m = manifest();
  for (const rung of [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]) {
    const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "brandforge-hero-video-")));
    try {
      fs.copyFileSync(FIXTURE_MP4, path.join(tmp, rung));
      const { files } = loadDonor(tmp);
      assert.ok(files[rung],
        "loadDonorFiles ships every file in the donor tree — dropping the clip at the documented path IS the deployment");
      assert.deepEqual(files[rung], fs.readFileSync(FIXTURE_MP4));

      const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
      assert.equal(out.ok, true, `hydration failed: ${out.error}`);
      const html = out.files["index.html"].toString("utf8");
      assert.deepEqual(ladderOf(html).sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
        "the client rung stays above the WSS rung whichever one holds bytes");
      for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
        assert.ok(!html.includes(residue), `${residue} survived hydration on a video-bearing build`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// 9. NO clip at all — the still rung over the drawn hero, cleanly
// ---------------------------------------------------------------------------
test("with no clip shipped the hero falls back cleanly: still rung painted, video dormant, nothing broken", () => {
  const m = manifest();
  const js = bundleOf();
  for (const optional of [false, true]) {
    const label = optional ? "every optional fact present" : "every optional fact blank";
    const html = hydrateHtml(tokensFor({ optional }));

    // Nothing points at a video that is not there: the island is data, not a
    // fetch, and the video element carries no src of any kind.
    const videoRefs = [...html.matchAll(/(?:src|href)="([^"]*\.mp4)"/gi)].map((mm) => mm[1]);
    assert.deepEqual(videoRefs, [],
      `a src pointing at an absent clip is a broken player on a customer's homepage (${label}) — this is the exact 404 the graft removes`);
    assert.doesNotMatch(html, /<source\s+src=/i, `no static source child may ship (${label})`);

    // The ladder island and the runtime survive hydration whole.
    assert.deepEqual(ladderOf(html).sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
      `the ladder island must survive hydration verbatim (${label})`);
    assert.match(html, /prefers-reduced-motion:\s*reduce/, `the reduced-motion guard must ship (${label})`);
  }

  // The still rung is intact: the img branch and the video poster name the
  // same file, so an unlit ladder leaves the poster photograph as the hero.
  const video = videoFragmentOf(js);
  assert.ok(video && video.includes("poster:T0"), "the video element must carry the still rung as its poster");
  assert.ok(js.includes("x.jsx(\"img\",{ref:i,src:T0"),
    "the img branch must keep painting the still under the dormant video");

  // Reduced motion is guarded in the component too (the SPA's own idiom).
  assert.match(js, /prefers-reduced-motion:\s*reduce/,
    "the hero component's own reduced-motion guard must stay — it decides whether the video mounts at all");
});
