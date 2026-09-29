"use strict";

// test/donor-tattoo-aurelia.test.js
//
// THE HERO VIDEO CONTRACT (owner's order, 2026-08-16): every donor is a
// live-action video hero site on a documented ladder —
//
//   rung 1  the CLIENT's own clip          assets/hero-client-tattoo.mp4
//   rung 2  a WSS-OWNED clip               media/hero-loop.mp4
//                                         (REAL bytes ship with the donor —
//                                         the donor-owned tattoo-studio
//                                         reel; this rung PLAYS today)
//   rung 3  the photograph rung            photo slot 1 — the hero img and
//                                         the video poster attribute are
//                                         the same file, ken-burns drift
//   rung 4  the drawn ink hero             grain, vignette and scrim layers
//
// This donor is a TanStack Start prerender with client hydration: the hero
// <video> element is mounted by the hydrated routes layer, so the element
// contract lives in the routes chunk (marked data-hero-video, full autoplay
// attrs, NO static source) and the ladder itself is data + a small runtime
// in index.html that waits for the mounted element and arms rungs top-down.
// The old onError display:none handler had to go with the static source: one
// failed rung would have hidden the element permanently and stranded the
// ladder before the real clip ever armed.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "tattoo-aurelia";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-tattoo-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Iron Lily Tattoo",
    CITY: "Portland", ADDRESS_CITY: "Portland", STATE: "OR", REGION: "OR",
    HERO_HEADLINE: "Custom Tattoos in Portland, OR",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
    // EMAIL is an unguarded optional on this donor (mailto hrefs, FAQ prose):
    // it must always resolve or hydration refuses — correctly.
    EMAIL: "ink@ironlily.example",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(503) 555-0119", PHONE_DIGITS: "5035550119",
      ADDRESS: "99 Alder St", ZIP: "97204", POSTAL: "97204",
      RATING: "4.9", REVIEW_COUNT: "210",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      PLACE_ID: "ChIJk7c8HxYKlVQR9W5ab6Y1YpE",
      GEO_LAT: "45.5231", GEO_LNG: "-122.6765",
      OWNER_NAME: "Mara Vance",
    });
  }
  return tv;
}

function bundleOf() {
  // The hero component ships in the routes chunk (stored .raw; the loader
  // restores the .js name at load time).
  return fs.readFileSync(path.join(DIR, "assets", "routes-B4oMbRrX.js.raw"), "utf8");
}

/** The marked hero-video jsx fragment, from the marker to the closing paren. */
function videoFragmentOf(js) {
  const marker = js.indexOf("jsx)(`video`");
  if (marker < 0) return null;
  return js.slice(marker, js.indexOf("})", marker) + 2);
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
test("the hero ships the video-first contract: a full-autoplay <video>, no static source, over the photo rung", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = bundleOf();

  // The contract is declared in the manifest, and the rejected language is gone.
  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined,
    "the owner rejected the no-hero-video contract; the key must not come back");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4,
    "the documented fallback ladder (client video, WSS clip, photo, drawn) must live in the manifest");

  // The <video> in the routes chunk carries the full autoplay contract, is
  // marked for the ladder runtime, and carries NO src of any kind.
  const video = videoFragmentOf(js);
  assert.ok(video, "no marked hero video element in the routes chunk — the ladder runtime has nothing to arm");
  assert.ok(video.includes('"data-hero-video":"1"'), `the hero video must carry the ladder marker (has: ${video})`);
  for (const attr of ["autoPlay:!0", "muted:!0", "loop:!0", "playsInline:!0", "preload:`metadata`", "poster:h.heroImage"]) {
    assert.ok(video.includes(attr), `the hero video must carry ${attr} (has: ${video})`);
  }
  assert.ok(!/\bsrc:/.test(video),
    "a static src is a guaranteed 404 until a clip ships — the runtime arms a rung only when its bytes exist");
  assert.ok(!js.includes("heroVideo,type:`video/mp4`"),
    "the old static <source> child pointed at a fixed path regardless of whether bytes shipped");
  assert.ok(!video.includes("onError"),
    "the old onError display:none stranded the ladder after one failed rung — the runtime owns errors now");

  // The poster is the first photo slot: the hero img and the video poster
  // are the same file, so the client's own photograph is rung 3.
  assert.equal(m.photo_slots[0], m.hero_video.poster,
    "the poster must be the first photo slot, so a filled hero photo and the poster are the same image");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)));
  assert.ok(js.includes("src:h.heroImage"), "the hero still paints the poster photograph beneath the video");

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
// 8. The rungs: the owned clip is REAL (rung 2 plays today); a clip dropped
//    at either documented path ships — with NO code change
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

test("the WSS rung is REAL: the donor-owned clip ships with every build and is a genuine mp4", () => {
  const m = manifest();
  const clip = path.join(DIR, m.hero_video.wss_fallback_clip_path);
  assert.ok(fs.existsSync(clip),
    "this donor owns its hero clip — the ladder's second rung must point at the real file");
  const bytes = fs.readFileSync(clip);
  assert.ok(bytes.length > 100000, `an owned hero clip should carry real bytes (${bytes.length})`);
  // mp4 magic: ....ftyp at byte 4 (brand follows).
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp",
    "the owned clip must be a real mp4 — a corrupt or placeholder file is a broken player");

  const { files } = loadDonor(DIR);
  assert.ok(files[m.hero_video.wss_fallback_clip_path],
    "loadDonorFiles ships every file in the donor tree — the owned clip ships on every build");
  assert.deepEqual(files[m.hero_video.wss_fallback_clip_path], bytes);
});

test("a clip dropped at a documented rung path ships and keeps the rung order — no code change", () => {
  const m = manifest();
  for (const rung of [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]) {
    const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "tattoo-hero-video-")));
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
// 9. NO client clip — the photo rung over the drawn hero, cleanly
// ---------------------------------------------------------------------------
test("with no client clip the hero falls back cleanly: photo rung painted, video dormant, nothing broken", () => {
  const m = manifest();
  const js = bundleOf();
  for (const optional of [false, true]) {
    const label = optional ? "every optional fact present" : "every optional fact blank";
    const html = hydrateHtml(tokensFor({ optional }));

    // Nothing points at a video that is not there: the island is data, not a
    // fetch, and the video element carries no src of any kind.
    const videoRefs = [...html.matchAll(/(?:src|href)="([^"]*\.mp4)"/gi)].map((mm) => mm[1]);
    assert.deepEqual(videoRefs, [],
      `a src pointing at an absent clip is a broken player on a customer's homepage (${label})`);
    assert.doesNotMatch(html, /<source\s+src=/i, `no static source child may ship (${label})`);

    // The ladder island and the runtime survive hydration whole.
    assert.deepEqual(ladderOf(html).sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
      `the ladder island must survive hydration verbatim (${label})`);
    assert.match(html, /prefers-reduced-motion:\s*reduce/, `the reduced-motion guard must ship (${label})`);
  }

  // The photo rung is intact: the hero still paints the poster photograph
  // with its ken-burns drift beneath the video element.
  assert.ok(js.includes("src:h.heroImage"),
    "the photo rung (the ken-burns still under the video) must stay painted");
  // And reduced motion is guarded twice over: the Tailwind motion-reduce hide
  // on the element, and the runtime's own guard.
  assert.match(js, /motion-reduce:hidden/,
    "the element's own motion-reduce class must stay — the donor's idiom for hiding the video");
});
