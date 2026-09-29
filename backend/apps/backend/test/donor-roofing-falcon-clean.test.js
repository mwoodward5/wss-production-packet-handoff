"use strict";

// test/donor-roofing-falcon-clean.test.js
//
// THE ROOFING VERTICAL'S PRIMARY DONOR (roofing-falcon-clean), rebuilt
// 2026-09-02 as a fictional-identity static template by the Lovable a-plus
// lane from the verbatim Falcon port lineage: hand-authored index.html
// (charcoal slab hero with grain, ticker, bento systems, SVG gallery,
// numeral storm-process rail, about, review cards, glass FAQ, inspection CTA
// panel, footer + floater), hand-authored stylesheet on --wss-* properties,
// one hero-layer bundle, and the verbatim port's owned roofline reel and
// photo library retained. THE HERO VIDEO LADDER contract (owner's order,
// 2026-08-16) survives the rebuild:
//
//   rung 1  the CLIENT's own clip          assets/hero-client-roofing.mp4
//   rung 2  a WSS-OWNED clip               assets/hero-fallback-roofing.mp4
//                                         (REAL bytes ship today - the
//                                         donor-owned roofline reel)
//   rung 3  the poster photograph          assets/hero-roof-bundled-BUtnB7RP.jpg
//   rung 4  the drawn charcoal hero        slab/grain/scrim layers
//
// These tests hold that contract:
//
//   1. The static design ships whole (page + css + hero bundle + photo
//      slots + the owned reel + the inspection anchor).
//   2. ZERO source-business identity AND zero template-identity atoms
//      survive in any shipped byte.
//   3. The hero video ladder contract (marked mount bundle, no src, island,
//      walker, kill-switch + paint-under CSS, REAL rung-2 bytes).
//   4. A clip dropped at a documented rung path ships — no code change.
//   5. Hydration resolves every token (no {{ or NEED residue), full and
//      bare; a phone-less build collapses the whole call path.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DIR = path.join(BACKEND, "donors-clean", "roofing-falcon-clean");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-roofing-falcon-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const mountBundle = () =>
  fs.readFileSync(path.join(DIR, "assets", "index-roofing-falcon-clean.js"), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Summit Line Roofing",
    CITY: "Fort Collins", ADDRESS_CITY: "Fort Collins", STATE: "CO", REGION: "CO",
    HERO_HEADLINE: "Roofing in Fort Collins, CO",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(970) 555-0177", PHONE_DIGITS: "9705550177",
      EMAIL: "hello@example.com", PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "40.5853", GEO_LNG: "-105.0844", GEO: "40.5853;-105.0844",
      COUNTY: "Larimer County", LICENSE: "CO-RC-88412",
      OWNER_NAME: "Dana Ruiz", ADDRESS: "1 Main St", ZIP: "80521", POSTAL: "80521",
    });
  }
  return tv;
}

function ladderOf(html) {
  const m = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

test("the static design ships whole: page, stylesheet, hero bundle, slots, owned reel, inspection anchor", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.ok(files["index.html"], "the page ships");
  assert.ok(files["assets/style.css"], "the hand-authored stylesheet ships");
  assert.ok(files["assets/index-roofing-falcon-clean.js"], "the hero mount bundle ships");
  for (const slot of m.photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  const html = files["index.html"].toString("utf8");
  assert.match(html, /class="ticker"/, "the systems ticker ships");
  assert.match(html, /class="bento"/, "the systems bento ships");
  assert.match(html, /class="floater"/, "the floating CTA ships");
  assert.match(html, /href="#contact"/, "the inspection anchor ships");
  assert.match(files["assets/style.css"].toString("utf8"), /--wss-accent/, "the stylesheet consumes --wss-* tokens");
});

test("TRUTH LAW — zero source-business and zero template-identity atoms in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.equal(m.donor_business_name, "Falcon Roofing LLC");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of [
      // the real source business's identity
      "Falcon Roofing LLC", "falcon-roofing.net", "mforchione", "Forchione",
      "Powell", "Delaware County", "(614) 715-0496", "6147150496",
      "16rhQWHwU2", "bbb.org/us/oh/powell",
      "lovableproject.com", "lovable.app",
      // the template's fictional demo identity
      "Falcon Ridge Roofing", "falconridgeroof.com", "Grant Okafor",
      "KS-RC-22908", "3165550157",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked identity: ${needle}`);
    }
  }
});

test("the hero video ladder contract: marked mount bundle, no src, island, poster — rung 2 is REAL", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = mountBundle();

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4,
    "the documented fallback ladder (client video, WSS clip, poster, drawn) must live in the manifest");

  const i = js.indexOf('"data-hero-video"');
  assert.ok(i >= 0, "the marked hero video element ships in the mount bundle");
  const frag = js.slice(i - 60, i + 460);
  for (const attr of [/muted:!0/, /loop:!0/, /playsInline:!0/, /preload:"none"/, /hidden:!0/, /poster:/]) {
    assert.match(frag, attr, `the hero video must carry ${attr}`);
  }
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "no static src — a rung arms only when its bytes shipped");
  assert.ok(!js.includes("<source src="), "no injected static <source> child may ship");

  const island = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  assert.ok(island, "the ladder island ships");
  const ladder = JSON.parse(island[1]);
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the client's clip outranks the WSS clip");
  assert.match(html, /heroRungs/, "the ladder runtime ships in the shell");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion never arms the video rungs");
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/,
    "the kill-switch must enforce hidden against video display preflights");
  assert.match(html, /data-wss-hero-fallback/, "the paint-under fallback block ships");

  // RUNG 2 IS REAL: the WSS-owned clip ships with every build, byte-identical
  // to the roofline reel this donor has owned since 2026-08-16.
  const clip = path.join(DIR, m.hero_video.wss_fallback_clip_path);
  assert.equal(m.hero_video.wss_fallback_clip_path, "assets/hero-fallback-roofing.mp4",
    "the fallback rung moved to assets/ at the 2026-08-17 verbatim staging");
  assert.ok(fs.existsSync(clip), "the owned clip ships with the donor");
  const bytes = fs.readFileSync(clip);
  assert.equal(bytes.length, 2765782, `the owned roofline reel carries its real bytes (${bytes.length})`);
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp", "the owned clip is a real mp4");
  const { files } = loadDonor(DIR);
  assert.ok(files[m.hero_video.wss_fallback_clip_path], "loadDonor ships the owned clip on every build");
  assert.deepEqual(files[m.hero_video.wss_fallback_clip_path], bytes);

  // The mount layer's own guards stay: reduced motion never mounts the clip.
  assert.match(js, /prefers-reduced-motion:\s*reduce/, "the mount layer's reduced-motion guard must stay");
});

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

test("a clip dropped at a documented rung path ships and keeps the rung order — no code change", () => {
  const m = manifest();
  for (const rung of [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]) {
    const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "roofing-falcon-hero-video-")));
    try {
      fs.copyFileSync(FIXTURE_MP4, path.join(tmp, rung));
      const { files } = loadDonor(tmp);
      assert.ok(files[rung],
        "loadDonorFiles ships every file in the donor tree — dropping the clip at the documented path IS the deployment");

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

test("hydration: a full token set leaves no residue; identity tokens land; a phone-less build collapses the call path", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 500)}`);
  const html = out.files["index.html"].toString("utf8");
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!html.includes(residue), `${residue} survived hydration in the shell`);
    assert.ok(!out.files["assets/index-roofing-falcon-clean.js"].toString("utf8").includes(residue),
      `${residue} survived hydration in the mount bundle`);
  }
  assert.ok(html.includes("Summit Line Roofing"), "the business name lands");
  assert.ok(html.includes("(970) 555-0177"), "the client phone lands");
  assert.match(html, /<title>Summit Line Roofing — .*Fort Collins, CO<\/title>/, "the composed title lands");
  assert.match(html, /Roofing &amp; storm repair in Fort Collins, CO/, "the hero eyebrow names the market");

  // NEED blocks: with a phone present the meta description carries the call
  // sentence; without one it flips to the form sentence — no hole either way.
  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true, `bare hydration failed: ${bare.error} ${JSON.stringify(bare.detail || "").slice(0, 400)}`);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Request an inspection online\./, "no-phone build flips the meta sentence");
  assert.match(bareHtml, /Book an inspection<\/a>/, "no-phone build swaps the header CTA to the anchor");
  assert.ok(!/href\s*=\s*["']tel:/.test(bareHtml), "no dialable href survives a phone-less build");
  assert.match(bareHtml, /href="#contact"/, "the inspection anchor survives a phone-less build");

  // Nothing points at a video that is not there: the island is data, not a
  // fetch, and the video element carries no src.
  const videoRefs = [...bareHtml.matchAll(/(?:src|href)="([^"]*\.(?:mp4|webm))"/gi)].map((mm) => mm[1]);
  assert.deepEqual(videoRefs, [], "a src pointing at an absent clip is a broken player on a customer's homepage");
});
