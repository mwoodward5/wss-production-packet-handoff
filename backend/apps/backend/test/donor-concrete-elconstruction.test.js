"use strict";

// test/donor-concrete-elconstruction.test.js
//
// THE CONCRETE VERTICAL'S PRIMARY DONOR (concrete-elconstruction), rebuilt
// 2026-09-02 as a fictional-identity static template by the Lovable a-plus
// lane: one hand-authored index.html (painted slab hero with grain, ticker,
// bento services, SVG work gallery, numeral process rail, about, review
// cards, glass FAQ, quote CTA panel, footer + floater), one hand-authored
// stylesheet on --wss-* properties, one hero-layer bundle, and the verbatim
// port's photo library and owned hero clip retained. These tests hold that
// contract:
//
//   1. The static design ships whole (page + css + hero bundle + photo slots
//      + the owned fallback clip + the quote anchor).
//   2. ZERO source-business identity AND zero template-identity atoms
//      survive in any shipped byte (every identity string is a token).
//   3. The hero video ladder contract (marked mount bundle, island, walker,
//      kill-switch + paint-under CSS, real rung-2 bytes).
//   4. A clip dropped at a documented rung path ships — no code change.
//   5. Hydration resolves every token (no {{ or NEED residue) and a
//      phone-less build collapses the whole call path and flips its copy.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "concrete-elconstruction";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-concrete-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const loadedFiles = () => loadDonor(DIR).files;

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Granite Ridge Concrete",
    CITY: "Boise", ADDRESS_CITY: "Boise", STATE: "ID", REGION: "ID",
    HERO_HEADLINE: "Concrete in Boise, ID",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(208) 555-0161", PHONE_DIGITS: "2085550161",
      EMAIL: "hello@example.com", PROFILE_URL: "https://maps.google.com/?cid=1",
      LICENSE: "ID-C-2231", COUNTY: "Ada County",
      GEO_LAT: "43.6150", GEO_LNG: "-116.2023",
    });
  }
  return tv;
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
// 1. The static design ships whole
// ---------------------------------------------------------------------------
test("the static design ships whole: page, stylesheet, hero bundle, photo slots, owned clip, quote anchor", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();

  assert.ok(files["index.html"], "the page ships");
  assert.ok(files["assets/style.css"], "the hand-authored stylesheet ships");
  assert.ok(files["assets/index-concrete-elconstruction.js"], "the hero bundle ships (the ONE browser script)");
  assert.ok(files["assets/index-PR5w8tQz.css"], "the compiled overflow-clip stylesheet ships");
  for (const slot of m.photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }

  const html = files["index.html"].toString("utf8");
  assert.match(html, /class="ticker"/, "the services ticker ships");
  assert.match(html, /class="bento"/, "the services bento ships");
  assert.match(html, /class="faq"/, "the glass accordion FAQ ships");
  assert.match(html, /class="floater"/, "the floating CTA ships");
  assert.match(html, /href="#contact"/, "the quote anchor ships");
  assert.match(files["assets/style.css"].toString("utf8"), /--wss-accent/, "the stylesheet consumes --wss-* tokens");

  // Exactly ONE browser bundle, referenced by the shell (a renamed bundle
  // nothing references would ship a blank page).
  const bundles = Object.keys(files).filter((rel) => /^assets\/index-.*\.js$/.test(rel));
  assert.deepEqual(bundles, ["assets/index-concrete-elconstruction.js"],
    "one self-contained bundle, referenced by the shell");
});

// ---------------------------------------------------------------------------
// 2. TRUTH LAW — zero source-business identity in any shipped byte
// ---------------------------------------------------------------------------
test("TRUTH LAW — zero source-business and zero template-identity atoms in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.equal(m.donor_business_name, "EL Construction");

  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of [
      // the real source business's identity
      "EL Construction", "elconstructionaz", "el-construction-tempe",
      "Tempe", "Maricopa", "(480) 256", "256-2343",
      "0x872b08485c2ea823", "ChIJI6guXEgIK4cR",
      "lovableproject.com", "lovable.app",
      // the template's fictional demo identity
      "Redbank Flatwork", "redbankflatwork.com", "Elena Ruiz",
      "Fort Myers", "Lee County", "FL-CGC-1524887", "2395550192",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked identity: ${needle}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 3. THE HERO VIDEO CONTRACT — mount bundle, island, walker, rung 2 real
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: marked mount bundle, no static src, ladder island, walker, kill-switch, real rung-2 bytes", () => {
  const m = manifest();
  const { files } = loadDonor(DIR);
  const js = fs.readFileSync(path.join(DIR, "assets", "index-concrete-elconstruction.js"), "utf8");
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined,
    "the owner rejected the no-hero-video contract; the key must not come back");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4,
    "the documented fallback ladder (client video, WSS clip, photo, drawn) must live in the manifest");

  // The marked element ships in the mount bundle with the hidden contract and
  // NO src of any kind.
  const marker = js.indexOf('"data-hero-video"');
  assert.ok(marker >= 0, "no marked hero video element in the mount bundle — the ladder runtime has nothing to arm");
  const frag = js.slice(marker - 60, marker + 430);
  assert.match(frag, /hidden:!0/, "the hero video must mount hidden");
  assert.match(frag, /poster:/, "the hero video must carry the poster photograph");
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag),
    "a static src is a guaranteed 404 until a clip ships — the runtime arms a rung only when its bytes exist");

  // The poster is the first photo slot: the hero picture and the video poster
  // are the same file, so the client's own photograph is rung 3.
  assert.equal(m.photo_slots[0], m.hero_video.poster,
    "the poster must be the first photo slot, so a filled hero photo and the poster are the same image");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)));
  assert.ok(js.includes(m.hero_video.poster.split("/").pop()),
    "the mount bundle must define the poster path it renders");
  assert.ok(html.includes(m.hero_video.poster.split("/").pop()),
    "the shell paints the poster — it is the LCP");

  // The ladder is data, not code — and the client's clip outranks ours.
  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "the hero-video-ladder JSON island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the ladder must walk the client's own video first, the WSS-owned clip second");
  assert.match(html, /heroRungs/, "the ladder runtime must ship in the shell");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion must never arm the video rungs");
  assert.match(html, /video\[data-hero-video\]/, "the runtime must wait for the mounted hero video element");
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/,
    "the kill-switch must enforce hidden against video display preflights");
  assert.ok(html.includes("data-wss-hero-fallback"), "the paint-under fallback surface must ship");

  // RUNG 2 IS REAL: the WSS-owned clip ships with every build as a genuine mp4.
  const clipPath = path.join(DIR, m.hero_video.wss_fallback_clip_path);
  assert.ok(fs.existsSync(clipPath), "this donor owns its hero clip — rung 2 must point at the real file");
  const bytes = fs.readFileSync(clipPath);
  assert.ok(bytes.length > 1000000, `an owned hero clip should carry real bytes (${bytes.length})`);
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp",
    "the owned clip must be a real mp4 — a corrupt or placeholder file is a broken player");
  assert.deepEqual(bytes, fs.readFileSync(path.join(DIR, "media", "hero-loop-lite.mp4")),
    "rung 2 is the mobile-weight re-encode (hero-loop-lite): the ledger and the shipped bytes must agree");
  assert.ok(files[m.hero_video.wss_fallback_clip_path],
    "loadDonorFiles ships every file in the donor tree — the owned clip ships on every build");
});

// ---------------------------------------------------------------------------
// 4. A clip dropped at a documented rung path ships — no code change
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

test("a clip dropped at a documented rung path ships and keeps the rung order — no code change", () => {
  const m = manifest();
  for (const rung of [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]) {
    const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "concrete-hero-video-")));
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

// ---------------------------------------------------------------------------
// 5. Hydration — every token resolves; the no-phone build flips its copy
// ---------------------------------------------------------------------------
test("hydration: a full token set leaves no residue anywhere; identity tokens land; the no-phone build flips", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);

  const watch = ["index.html", "assets/index-concrete-elconstruction.js", "assets/style.css"];
  for (const rel of watch) {
    const buf = out.files[rel];
    assert.ok(buf, `hydrated output must include ${rel}`);
    const text = buf.toString("utf8");
    for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
      assert.ok(!text.includes(residue), `${residue} survived hydration in ${rel}`);
    }
  }

  const html = out.files["index.html"].toString("utf8");
  assert.ok(html.includes("Granite Ridge Concrete"), "the business name lands");
  assert.ok(html.includes("(208) 555-0161"), "the client phone lands");
  assert.match(html, /"@type"\s*:\s*"GeoCoordinates"/, "the guarded GeoCoordinates block lands");
  assert.match(html, /"latitude"\s*:\s*"43\.6150"/, "the verified latitude survives as semantics");
  assert.match(html, /"longitude"\s*:\s*"-116\.2023"/, "the verified longitude survives as semantics");

  // NEED blocks: without a phone the meta sentence flips to the quote route
  // and every call construct is gone.
  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true, `phone-less hydration failed: ${bare.error} ${JSON.stringify(bare.detail || "").slice(0, 400)}`);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Request a written quote online\./, "no-phone build flips the meta sentence");
  assert.match(bareHtml, /Get a quote/, "no-phone build swaps the header CTA to the quote anchor");
  assert.ok(!/href\s*=\s*["']tel:/.test(bareHtml), "no dialable href survives a phone-less build");
  assert.match(bareHtml, /href="#contact"/, "the quote anchor survives a phone-less build");

  // Nothing points at a video that is not there on a blank-optional build: the
  // island is data, not a fetch, and the video element carries no src.
  const videoRefs = [...bareHtml.matchAll(/(?:src|href)="([^"]*\.(?:mp4|webm))"/gi)].map((mm) => mm[1]);
  assert.deepEqual(videoRefs, [], "a src pointing at an absent clip is a broken player on a customer's homepage");
});
