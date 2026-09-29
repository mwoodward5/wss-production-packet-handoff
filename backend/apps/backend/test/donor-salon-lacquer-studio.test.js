"use strict";

// test/donor-salon-lacquer-studio.test.js
//
// THE VERBATIM LACQUER DONOR (owner's order, 2026-08-17): the salon donor is
// the mwoodward5/bb-nails-concept editorial design (Italiana/Cormorant
// display type, six-layer hero with parallax/veil/lamp-light/polish gloss,
// appointment strip, lookbook, finish atlas, service chapters, neighborhood
// map, city×service authority tree, answers page, concierge form) shipped
// VERBATIM from its own source — with every identity string tokenized, the
// source's Portland-metro geography excised for an island-driven template,
// a content bridge (window.__WSS_CONTENT__) that renders VERIFIED client
// services/faqs/areas/hours on real builds, and the hero video ladder
// (client clip → WSS clip → design photograph). These tests hold that
// contract:
//
//   1. The compiled design ships whole (chunks + css + slots + poster).
//   2. ZERO source-business identity survives in any shipped byte.
//   3. The hero video ladder contract (marked video, no src, island).
//   4. The content bridge prefers verified data over template defaults.
//   5. Hydration resolves every token (no {{ or NEED residue on a full
//      build) and optional facts collapse honestly on a bare build.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DIR = path.join(BACKEND, "donors-clean", "salon-lacquer-studio");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-salon-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
// ESM chunks ship as .js.raw (Vercel transpile guard); the loader restores
// the real name, disk reads here carry the suffix.
const bundleFile = () =>
  fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.js(\.raw)?$/.test(f));
const bundle = () => fs.readFileSync(path.join(DIR, "assets", bundleFile()), "utf8");
const hydratedAppChunk = (out) =>
  out.files[`assets/${bundleFile().replace(/\.raw$/, "")}`].toString("utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Lacquer Studio", CITY: "Austin", ADDRESS_CITY: "Austin",
    STATE: "TX", REGION: "TX",
    HERO_HEADLINE: "Austin's most-booked nail salon for considered manicures.",
    HERO_LINE_A: "A salon for the", HERO_LINE_B: "slow art",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(512) 555-0189", PHONE_DIGITS: "5125550189",
      EMAIL: "hello@example.com", PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "30.2672", GEO_LNG: "-97.7431",
    });
  }
  return tv;
}

test("the verbatim design ships whole: app chunk, css, design assets, fonts", () => {
  const { files } = loadDonor(DIR);
  assert.ok(files["index.html"], "the shell ships");
  assert.ok(bundleFile().startsWith("index-"), "the compiled app chunk ships");
  // One ESM chunk (.js.raw on disk) — the parse gate requires single-chunk.
  const jsChunks = Object.keys(files).filter((k) => /^assets\/.*\.js$/.test(k));
  assert.equal(jsChunks.length, 1, `expected exactly one app chunk, found ${jsChunks.length}`);
  const cssKey = Object.keys(files).find((k) => /^assets\/index-.*\.css$/.test(k));
  assert.ok(cssKey, "the compiled css ships");
  for (const slot of manifest().photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  assert.ok(files["assets/salon-interior-D4nzbAQV.webp"], "the studio photograph ships");
  const html = files["index.html"].toString("utf8");
  assert.match(html, /hero-video-ladder/, "the ladder island ships in the shell");
  assert.match(files[cssKey].toString("utf8"), /Italiana/, "the design's display typeface loads");
  // The design's signature furniture is present in the compiled app chunk.
  const js = bundle();
  assert.match(js, /Appointment Concierge/, "the concierge form ships");
  assert.match(js, /Service Menu Atlas/, "the menu atlas ships");
  assert.match(js, /Finish Guide/, "the finish atlas ships");
  assert.match(js, /id:"estimate"/, "the contact/estimate anchor ships");
});

test("TRUTH LAW — zero source-business identity in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.equal(m.donor_business_name, "BB Nails and Spa");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of [
      "BB Nails", "bb-nails", "(971) 347-3274", "9713473274", "971) 347",
      "Beaverton", "Gresham", "Lake Oswego", "Willamette", "US-26", "Pearl District",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked source identity: ${needle}`);
    }
  }
  // Portland itself is NOT a needle — the Tempe/temperature trap (a legitimate
  // Portland prospect must not fail the gate on its own city name).
});

test("the hero video ladder contract: marked <video>, no src, island, poster", () => {
  const m = manifest();
  const js = bundle();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)),
    "the poster is the shipped design photograph (hero-hands)");
  assert.equal(m.hero_wash, undefined,
    "no hero_wash — this hero owns its own pixels; a second scrim flattens the photograph and the video rung");

  const i = js.indexOf('"data-hero-video"');
  assert.ok(i >= 0, "the marked hero video element ships in the bundle");
  const frag = js.slice(i - 80, i + 420);
  for (const attr of ["autoPlay", "muted", "loop", "playsInline", 'preload:"metadata"', "hidden", "poster"]) {
    assert.ok(frag.includes(attr), `the hero video must carry ${attr}`);
  }
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "no static src — a rung arms only when its bytes shipped");

  const island = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  assert.ok(island, "the ladder island ships");
  const ladder = JSON.parse(island[1]);
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the client's clip outranks the WSS clip");
});

test("the content bridge prefers verified data over template defaults", () => {
  const js = bundle();
  assert.ok(js.includes("__WSS_CONTENT__"), "the bundle reads the engine's content island");
  // The minifier renames locals; the island property read and the template
  // defaults it falls back to are the stable anchors.
  assert.match(js, /Signature Manicure/, "template default services exist as the fallback");
  // areaServed carries the market city token (LocalBusiness + Service graph).
  assert.ok(js.includes('areaServed') && js.includes('["{{CITY}}"]'),
    "areaServed falls back to {{CITY}} when no verified coverage exists");
  assert.ok(js.includes('"{{HERO_LINE_A}}"') && js.includes('"{{HERO_LINE_B}}"'),
    "the h1 spends the client's own headline lines, never the donor's sentence");
});

test("hydration: a full token set leaves no residue; identity tokens land", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error}`);
  const html = out.files["index.html"].toString("utf8");
  const js = hydratedAppChunk(out);
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!html.includes(residue), `${residue} survived hydration in the shell`);
    assert.ok(!js.includes(residue), `${residue} survived hydration in the app chunk`);
  }
  assert.ok(js.includes("Lacquer Studio"), "the business name lands in the bundle");
  assert.ok(js.includes("(512) 555-0189"), "the client phone lands");
  assert.ok(js.includes("Austin"), "the market city lands (areaServed carries {{CITY}})");
  assert.match(html, /Call \(512\) 555-0189\./, "the NEED-guarded meta sentence carries the phone");

  // The bare build: optional facts blank, guards flip, nothing dangles.
  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Book an appointment online\./, "no-phone build flips the meta sentence");
  const bareJs = hydratedAppChunk(bare);
  assert.ok(!bareJs.includes('tel:+1"'), "no phone means no dangling +1 tel scheme in code");
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!bareJs.includes(residue), `${residue} survived bare hydration`);
  }
});

test("a clip dropped at the WSS fallback path ships — no code change", () => {
  const FIXTURE_MP4 = path.join(BACKEND, "test", "fixtures", "mirror-donor", "media", "hero-loop.mp4");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "salon-hero-video-"));
  const walk = (from, to) => {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
      const f = path.join(from, e.name), t = path.join(to, e.name);
      if (e.isDirectory()) { fs.mkdirSync(t, { recursive: true }); walk(f, t); }
      else fs.copyFileSync(f, t);
    }
  };
  try {
    walk(DIR, tmp);
    fs.copyFileSync(FIXTURE_MP4, path.join(tmp, "assets", "hero-fallback-salon.mp4"));
    const { files } = loadDonor(tmp);
    assert.ok(files["assets/hero-fallback-salon.mp4"],
      "loadDonorFiles ships every file in the tree — the documented path IS the deployment");
    assert.deepEqual(files["assets/hero-fallback-salon.mp4"], fs.readFileSync(FIXTURE_MP4));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
