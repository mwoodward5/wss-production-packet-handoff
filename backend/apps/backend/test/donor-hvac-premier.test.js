"use strict";

// test/donor-hvac-premier.test.js
//
// THE HVAC VERTICAL'S PRIMARY DONOR (hvac-premier), rebuilt 2026-09-02 as a
// fictional-identity static template by the Lovable a-plus lane. THE HERO
// VIDEO CONTRACT (owner's order, 2026-08-16) survives the rebuild — every
// donor is a live-action video hero site on a documented ladder:
//
//   rung 1  the CLIENT's own clip          assets/hero-client-hvac.mp4
//   rung 2  a WSS-OWNED clip               hero/hero-loop.mp4
//                                         (REAL bytes ship with the donor —
//                                         the donor-owned generic HVAC loop;
//                                         this rung PLAYS today)
//   rung 3  the poster photograph          hero/hero-poster.jpg — painted
//                                         under the video by the mount
//                                         bundle AND the video's poster
//   rung 4  the drawn navy hero            slab/grain/scrim layers
//
// Since the static rebuild the <video> element is mounted by the deferred
// hero layer bundle (assets/index-hvac-premier.js, marked data-hero-video,
// hidden, no static src) and the ladder is data + the walker runtime in
// index.html that waits for the mounted element and arms rungs top-down,
// stepping down on error, never under reduced motion.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "hvac-premier";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-hvac-premier-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Family Heating and Air",
    CITY: "Bridgeport", ADDRESS_CITY: "Bridgeport", STATE: "CT", REGION: "CT",
    HERO_HEADLINE: "HVAC in Bridgeport, CT",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
    HERO_LINE_A: "When the season", HERO_LINE_B: "breaks the rules,", HERO_LINE_C: "we hold the line.",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(203) 555-0134", PHONE_DIGITS: "2035550134",
      EMAIL: "hello@example.com", ADDRESS: "1 Main St", ZIP: "06604", POSTAL: "06604",
      RATING: "4.9", REVIEW_COUNT: "112", COUNTY: "Fairfield County",
      LICENSE: "CT-PLC-02841", OWNER_NAME: "Dana Whitfield",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "41.1792", GEO_LNG: "-73.1894",
    });
  }
  return tv;
}

function mountBundleOf() {
  return fs.readFileSync(path.join(DIR, "assets", "index-hvac-premier.js"), "utf8");
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
// The static design ships whole
// ---------------------------------------------------------------------------
test("the static design ships whole: page, stylesheet, hero bundle, slots, owned clip, CTA anchor", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.ok(files["index.html"], "the page ships");
  assert.ok(files["assets/style.css"], "the hand-authored stylesheet ships");
  assert.ok(files["assets/index-hvac-premier.js"], "the hero mount bundle ships");
  for (const slot of m.photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  const html = files["index.html"].toString("utf8");
  assert.match(html, /class="ticker"/, "the systems ticker ships");
  assert.match(html, /class="bento"/, "the systems bento ships");
  assert.match(html, /class="floater"/, "the floating CTA ships");
  assert.match(html, /href="#contact"/, "the comfort-design anchor ships");
  assert.match(files["assets/style.css"].toString("utf8"), /--wss-accent/, "the stylesheet consumes --wss-* tokens");
});

test("TRUTH LAW — zero source-business and zero template-identity atoms in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.equal(m.donor_business_name, "Texan's HVAC");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of [
      // the real source business's identity
      "Texan's HVAC", "texanshvac.com", "pywaller@yahoo.com", "Waller County",
      "832) 473-7554", "8324737554", "hallf",
      "lovableproject.com", "lovable.app",
      // the template's fictional demo identity
      "Saguaro Peak Air", "saguaropeakair.com", "Devon Castellano",
      "AZ-ROC-330914", "4805550166",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked identity: ${needle}`);
    }
  }
});

// ---------------------------------------------------------------------------
// THE HERO VIDEO CONTRACT — the mount bundle, the ladder, and nothing that 404s
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: marked mount bundle, no static src, over the poster rung", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = mountBundleOf();

  // The contract is declared in the manifest, and the rejected language is gone.
  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined,
    "the owner rejected the no-hero-video contract; the key must not come back");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4,
    "the documented fallback ladder (client video, WSS clip, poster, drawn) must live in the manifest");

  // The <video> in the mount bundle carries the marked/hidden contract with
  // the poster and NO src of any kind.
  const marker = js.indexOf('"data-hero-video"');
  assert.ok(marker >= 0, "no marked hero video element in the mount bundle — the ladder runtime has nothing to arm");
  const frag = js.slice(marker - 60, marker + 430);
  for (const attr of [/muted:!0/, /loop:!0/, /playsInline:!0/, /preload:"none"/, /hidden:!0/, /poster:/]) {
    assert.match(frag, attr, `the hero video must carry ${attr}`);
  }
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag),
    "a static src is a guaranteed 404 until a clip ships — the runtime arms a rung only when its bytes exist");

  // The poster rung: the video poster, the paint-under CSS surface and the
  // manifest name the same file.
  assert.equal(m.hero_video.poster, "hero/hero-poster.jpg");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)),
    "the poster rung is a real file — the still the hero falls back to");
  assert.ok(js.includes(m.hero_video.poster), "the mount bundle poster names the still rung");
  assert.match(html, /data-wss-hero-fallback/, "the paint-under fallback block ships");
  assert.match(html, /hero\/hero-poster\.jpg/, "the paint-under surface paints the poster photograph");

  // The ladder is data, not code — and the client's clip outranks ours.
  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "the hero-video-ladder JSON island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the ladder must walk the client's own video first, the WSS-owned clip second");

  // The runtime walk is present and guarded, with the kill-switch CSS.
  assert.match(html, /heroRungs/, "the runtime must read the ladder island");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion must never arm the video rungs");
  assert.match(html, /video\[data-hero-video\]/, "the runtime must wait for the mounted hero video element");
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/,
    "the kill-switch must enforce hidden against video display preflights");
});

// ---------------------------------------------------------------------------
// The rungs: the owned clip is REAL (rung 2 plays today); a clip dropped
// at either documented path ships — with NO code change
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
    const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "hvac-premier-hero-video-")));
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
// NO client clip — the poster rung over the drawn hero, cleanly
// ---------------------------------------------------------------------------
test("with no client clip the hero falls back cleanly: poster rung painted, video dormant, nothing broken", () => {
  const m = manifest();
  const js = mountBundleOf();
  for (const optional of [false, true]) {
    const label = optional ? "every optional fact present" : "every optional fact blank";
    const html = hydrateHtml(tokensFor({ optional }));

    // Nothing points at a video that is not there: the island is data, not a
    // fetch, and the video element carries no src of any kind.
    const videoRefs = [...html.matchAll(/(?:src|href)="([^"]*\.(?:mp4|webm))"/gi)].map((mm) => mm[1]);
    assert.deepEqual(videoRefs, [],
      `a src pointing at an absent clip is a broken player on a customer's homepage (${label})`);
    assert.doesNotMatch(html, /<source\s+src=/i, `no static source child may ship (${label})`);

    // The ladder island and the runtime survive hydration whole.
    assert.deepEqual(ladderOf(html).sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
      `the ladder island must survive hydration verbatim (${label})`);
    assert.match(html, /prefers-reduced-motion:\s*reduce/, `the reduced-motion guard must ship (${label})`);
  }

  // The poster rung is intact: the paint-under surface paints the poster under
  // the video, and the mount's poster attribute names the same file.
  assert.match(js, /poster:HERO_POSTER/, "the mount's poster must be the still rung");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  assert.match(html, /video\[data-hero-video\]\s*\{\s*background:[^}]*hero\/hero-poster\.jpg/,
    "the paint-under surface must paint the poster photograph under the clip");

  // Reduced motion is guarded in the mount layer too — it never mounts the
  // video element at all.
  assert.match(js, /prefers-reduced-motion:\s*reduce/,
    "the mount layer's own reduced-motion guard must stay — it never mounts the video element at all");
});

// ---------------------------------------------------------------------------
// Hydration — every token resolves; the no-phone build collapses the call path
// ---------------------------------------------------------------------------
test("hydration: a full token set leaves no residue; a phone-less build collapses the call path and flips its copy", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);

  const watch = ["index.html", "assets/index-hvac-premier.js", "assets/style.css"];
  for (const rel of watch) {
    const text = out.files[rel].toString("utf8");
    for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
      assert.ok(!text.includes(residue), `${residue} survived hydration in ${rel}`);
    }
  }
  const html = out.files["index.html"].toString("utf8");
  assert.ok(html.includes("Family Heating and Air"), "the business name lands");
  assert.ok(html.includes("(203) 555-0134"), "the client phone lands");

  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true, `phone-less hydration failed: ${bare.error} ${JSON.stringify(bare.detail || "").slice(0, 400)}`);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Request a comfort design online\./, "no-phone build flips the meta sentence");
  assert.match(bareHtml, /Request a comfort design<\/a>/, "no-phone build swaps the header CTA to the anchor");
  assert.ok(!/href\s*=\s*["']tel:/.test(bareHtml), "no dialable href survives a phone-less build");
  assert.match(bareHtml, /href="#contact"/, "the comfort-design anchor survives a phone-less build");
});
