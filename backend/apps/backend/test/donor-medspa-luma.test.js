"use strict";

// test/donor-medspa-luma.test.js
//
// THE MED-SPA VERTICAL'S PRIMARY DONOR (medspa-luma), rebuilt 2026-09-02 as
// a fictional-identity static template by the Lovable a-plus lane. THE HERO
// VIDEO CONTRACT (owner's order, 2026-08-16) survives the rebuild —
//
//   rung 1  the CLIENT's own clip          assets/hero-client-medspa.mp4
//   rung 2  a WSS-OWNED clip               assets/hero-fallback-medspa.mp4
//                                         (REAL bytes ship today)
//   rung 3  the drawn hero-texture         the light radial surface this
//                                         donor always shipped
//
// This donor has NO photograph rung BY DESIGN: its gallery is drawn SVG
// illustration, not photography, because med-spa before/after and facility
// imagery is the vertical's highest-liability leak surface. So the marked
// video carries no poster and stays hidden until a rung actually loads; an
// unlit ladder leaves the drawn hero exactly as it was. Since the static
// rebuild the element is mounted by the deferred hero layer bundle
// (assets/index-medspa-luma.js, marked data-hero-video, hidden, no static
// src) and the ladder is data + the walker runtime in index.html that arms
// rungs top-down, stepping down on error, never under reduced motion.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DONORS_CLEAN = path.join(BACKEND, "donors-clean");
const DONOR = "medspa-luma";
const DIR = path.join(DONORS_CLEAN, DONOR);

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-medspa-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const mountBundle = () => fs.readFileSync(path.join(DIR, "assets", "index-medspa-luma.js"), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Luma Aesthetics Studio",
    CITY: "Scottsdale", ADDRESS_CITY: "Scottsdale", STATE: "AZ", REGION: "AZ",
    HERO_HEADLINE: "Med Spa in Scottsdale, AZ",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(480) 555-0171", PHONE_DIGITS: "4805550171",
      EMAIL: "hello@example.com", ADDRESS: "1 Camelback Rd", ZIP: "85251", POSTAL: "85251",
      RATING: "4.9", REVIEW_COUNT: "88", COUNTY: "Maricopa County",
      LICENSE: "AZ-MD-99214", OWNER_NAME: "Dr. Priya Raman",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "33.4942", GEO_LNG: "-111.9261", GEO: "33.4942;-111.9261",
    });
  }
  return tv;
}

function ladderOf(html) {
  const m = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// ---------------------------------------------------------------------------
// The static design ships whole
// ---------------------------------------------------------------------------
test("the static design ships whole: page, stylesheet, hero bundle, drawn slots, owned clip, consultation anchor", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.ok(files["index.html"], "the page ships");
  assert.ok(files["assets/style.css"], "the hand-authored stylesheet ships");
  assert.ok(files["assets/index-medspa-luma.js"], "the hero mount bundle ships");
  for (const slot of m.photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  // The gallery is drawn SVG by design — no photography rides this vertical.
  assert.ok(m.photo_slots.every((slot) => slot.endsWith(".svg")),
    "med-spa liability surface: every slot must be drawn illustration, not photography");
  const html = files["index.html"].toString("utf8");
  assert.match(html, /class="ticker"/, "the treatments ticker ships");
  assert.match(html, /class="bento"/, "the treatments bento ships");
  assert.match(html, /class="floater"/, "the floating CTA ships");
  assert.match(html, /href="#contact"/, "the consultation anchor ships");
  assert.match(files["assets/style.css"].toString("utf8"), /--wss-accent/, "the stylesheet consumes --wss-* tokens");
});

test("TRUTH LAW — zero synthetic and zero template-identity atoms in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.equal(m.donor_business_name, "Luma Aesthetics");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of [
      // the synthetic donor identity
      "Luma Aesthetics", "(555) 010-0100", "5550100100",
      // the template's fictional demo identity
      "Luma Aesthetic Medicine", "lumaaesthetic.com", "Dr. Adaeze Oyelaran",
      "4255550198", "Bellevue",
      "lovableproject.com", "lovable.app",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked identity: ${needle}`);
    }
  }
});

// ---------------------------------------------------------------------------
// THE HERO VIDEO CONTRACT — mount bundle, ladder, walker, kill-switch
// ---------------------------------------------------------------------------
test("the hero ships the video-first contract: a hidden-until-armed <video> over the drawn texture hero", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  const js = mountBundle();

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.equal(m.no_hero_video, undefined,
    "the owner rejected the no-hero-video contract; the key must not come back");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 3,
    "the documented ladder (client video, WSS clip, drawn texture) must live in the manifest");

  // The marked element ships in the mount bundle — hidden, no poster, no src.
  const marker = js.indexOf('"data-hero-video"');
  assert.ok(marker >= 0, "no marked hero video element in the mount bundle — the ladder runtime has nothing to arm");
  const frag = js.slice(marker - 60, marker + 430);
  assert.match(frag, /hidden:!0/, "the hero video must mount hidden");
  assert.ok(!/poster:/.test(frag), "this family has no photograph rung — the video carries no poster");
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "no static src — a rung arms only when its bytes shipped");

  // The ladder is data, client rung first; the walker + kill-switch ship.
  const ladder = ladderOf(html);
  assert.ok(ladder && Array.isArray(ladder.sources), "the ladder island must parse");
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the client's clip outranks the WSS clip");
  assert.match(html, /heroRungs/, "the ladder runtime ships in the shell");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion never arms the video rungs");
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/,
    "the kill-switch must enforce hidden against video display preflights");
  assert.match(html, /data-wss-hero-fallback/, "the paint-under fallback surface ships");
  assert.match(js, /prefers-reduced-motion:\s*reduce/,
    "the mount layer's own reduced-motion guard must stay — it never mounts the video element at all");
});

test("the WSS fallback clip ships as real rung-2 bytes (added 2026-08-19)", () => {
  const m = manifest();
  const clip = path.join(DIR, m.hero_video.wss_fallback_clip_path);
  assert.ok(fs.existsSync(clip), "the WSS-owned clip must ship with the donor");
  const bytes = fs.readFileSync(clip);
  assert.ok(bytes.length > 100000, `real clip bytes expected (${bytes.length})`);
  assert.equal(bytes.slice(4, 8).toString("ascii"), "ftyp", "the clip must be a real mp4");
  const { files } = loadDonor(DIR);
  assert.ok(files[m.hero_video.wss_fallback_clip_path], "loadDonor ships the clip on every build");
  assert.deepEqual(files[m.hero_video.wss_fallback_clip_path], bytes);
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
    const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "medspa-luma-hero-video-")));
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
// NO clip shipped — the hero stays the drawn texture, cleanly
// ---------------------------------------------------------------------------
test("with no clip shipped the hero stays the drawn texture: video hidden and dormant, nothing broken", () => {
  const m = manifest();
  const tmp = copyDonorTree(fs.mkdtempSync(path.join(os.tmpdir(), "medspa-luma-noclip-")));
  try {
    fs.rmSync(path.join(tmp, m.hero_video.client_video_path), { force: true });
    fs.rmSync(path.join(tmp, m.hero_video.wss_fallback_clip_path), { force: true });
    const { files } = loadDonor(tmp);
    const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
    assert.equal(out.ok, true, `hydration failed: ${out.error}`);
    const html = out.files["index.html"].toString("utf8");

    // Nothing points at a video that is not there: the island is data, not a
    // fetch, and the video element carries no src of any kind.
    const videoRefs = [...html.matchAll(/(?:src|href)="([^"]*\.(?:mp4|webm))"/gi)].map((mm) => mm[1]);
    assert.deepEqual(videoRefs, [], "a src pointing at an absent clip is a broken player on a customer's homepage");
    assert.doesNotMatch(html, /<source\s+src=/i, "no static source child may ship");

    // The ladder island and the runtime survive hydration whole.
    assert.deepEqual(ladderOf(html).sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
      "the ladder island must survive hydration verbatim");
    assert.match(html, /data-wss-hero-fallback/, "the drawn-texture surface stays painted");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Hydration — every token resolves; the no-phone build collapses the call path
// ---------------------------------------------------------------------------
test("hydration: a full token set leaves no residue; a phone-less build collapses the call path and flips its copy", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);

  for (const rel of ["index.html", "assets/index-medspa-luma.js", "assets/style.css"]) {
    const text = out.files[rel].toString("utf8");
    for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
      assert.ok(!text.includes(residue), `${residue} survived hydration in ${rel}`);
    }
  }
  const html = out.files["index.html"].toString("utf8");
  assert.ok(html.includes("Luma Aesthetics Studio"), "the business name lands");
  assert.ok(html.includes("(480) 555-0171"), "the client phone lands");

  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true, `phone-less hydration failed: ${bare.error} ${JSON.stringify(bare.detail || "").slice(0, 400)}`);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Book a consultation online\./, "no-phone build flips the meta sentence");
  assert.ok(!/href\s*=\s*["']tel:/.test(bareHtml), "no dialable href survives a phone-less build");
  assert.match(bareHtml, /href="#contact"/, "the consultation anchor survives a phone-less build");
});
