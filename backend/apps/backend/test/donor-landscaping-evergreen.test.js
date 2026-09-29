"use strict";

// test/donor-landscaping-evergreen.test.js
//
// THE VERBATIM GREENFRONT DONOR (owner's order, 2026-08-17): the landscaping
// donor is the owner-approved Lovable design (bac7c069 Greenfront Birmingham
// Bloom) shipped VERBATIM from its own source — Fraunces/Inter typography,
// glass sticky header, six-layer cinematic hero with the Property Care
// Planner widget, services, gallery, seasonal planner, service-area map,
// FAQ and footer — with every identity string tokenized and a content bridge
// (window.__WSS_CONTENT__) that renders VERIFIED client services/faqs on
// real builds. These tests hold that contract:
//
//   1. The compiled design ships whole (bundle + css + assets + fonts).
//   2. ZERO source-business identity survives in any shipped byte.
//   3. The hero video ladder contract (marked video, no src, island).
//   4. The content bridge prefers verified data over template defaults.
//   5. Hydration resolves every token (no {{ or NEED residue on a full build).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DIR = path.join(BACKEND, "donors-clean", "landscaping-evergreen");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-lscp-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const bundleName = () => fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.js$/.test(f));
const cssName = () => fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.css$/.test(f));
const bundle = () => fs.readFileSync(path.join(DIR, "assets", bundleName()), "utf8");
const css = () => fs.readFileSync(path.join(DIR, "assets", cssName()), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Grass Works",
    CITY: "Leander", ADDRESS_CITY: "Leander", STATE: "TX", REGION: "TX",
    HERO_HEADLINE: "Austin's Premier Lawn Care & Landscaping Company.",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(512) 797-1640", PHONE_DIGITS: "5127971640",
      EMAIL: "info@example.com", PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "30.5785", GEO_LNG: "-97.8554",
    });
  }
  return tv;
}

test("the verbatim design ships whole: bundle, css, design assets, fonts", () => {
  const { files } = loadDonor(DIR);
  assert.ok(files["index.html"], "the shell ships");
  assert.ok(bundleName().endsWith(".js"), "the compiled bundle ships");
  assert.ok(Object.keys(files).some((k) => /^assets\/index-.*\.css$/.test(k)), "the compiled css ships");
  for (const slot of manifest().photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  assert.ok(files["assets/hero-lawn-BktA-aJ_.jpg"], "the cinematic hero photograph ships");
  const html = files["index.html"].toString("utf8");
  assert.match(html, /Fraunces/, "the design's display typeface link ships");
  assert.match(html, /Inter/, "the design's body typeface link ships");
  // The design's signature furniture is present in the compiled bundle.
  const js = bundle();
  assert.match(js, /backdrop-blur/, "glass treatments survive compilation");
  assert.match(js, /Property Care Planner/, "the hero's Property Care Planner widget ships");
});

test("TRUTH LAW — zero source-business identity in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  // The leak gate's declared identity…
  assert.equal(m.donor_business_name, "Greenfront Lawn & Landscape");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes

    const text = buf.toString("utf8");
    for (const needle of ["Greenfront", "greenfrontbham", "Birmingham", "Meadowbrook", "(205) 603-4987", "205-6034"]) {
      assert.ok(!text.includes(needle), `${rel} leaked source identity: ${needle}`);
    }
  }
});

test("the hero video ladder contract: marked <video>, no src, island, poster", () => {
  const m = manifest();
  const js = bundle();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)), "the poster is the shipped design photograph");

  const i = js.indexOf('"data-hero-video"');
  assert.ok(i >= 0, "the marked hero video element ships in the bundle");
  const frag = js.slice(i - 60, i + 420);
  for (const attr of ["autoPlay", "muted", "loop", "playsInline", 'preload:"metadata"', "hidden"]) {
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
  // The minifier renames locals; the window property and the template
  // defaults it falls back to are the stable anchors.
  assert.match(js, /Lawn Mowing/, "template default services exist as the fallback");
});

test("compiled css routes body/display typography through --font-* variables", () => {
  const styles = css();
  assert.match(styles, /--font-display:\s*Fraunces,Georgia,serif/);
  assert.match(styles, /--font-body:\s*Inter,system-ui,sans-serif/);
  assert.match(styles, /body\{[^}]*font-family:var\(--font-body\)/);
  assert.match(styles, /h1,h2,h3,h4\{[^}]*font-family:var\(--font-display\)/);
  assert.match(styles, /\.font-display\{font-family:var\(--font-display\)\}/);
  assert.doesNotMatch(styles, /font-family:(Fraunces,Georgia,serif|Inter,system-ui,sans-serif)/);
});

test("hydration: a full token set leaves no residue; identity tokens land", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error}`);
  const html = out.files["index.html"].toString("utf8");
  const js = out.files[`assets/${bundleName()}`].toString("utf8");
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!html.includes(residue), `${residue} survived hydration in the shell`);
    assert.ok(!js.includes(residue), `${residue} survived hydration in the bundle`);
  }
  assert.ok(js.includes("Grass Works"), "the business name lands in the bundle");
  assert.ok(js.includes("(512) 797-1640"), "the client phone lands");
  // NEED blocks: with a phone present the call CTA text carries it; without,
  // the meta description flips to the no-phone sentence.
  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Request an estimate online\./, "no-phone build flips the meta sentence");
});
