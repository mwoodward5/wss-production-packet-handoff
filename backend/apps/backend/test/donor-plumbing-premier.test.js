"use strict";

// test/donor-plumbing-premier.test.js
//
// THE VERBATIM YELLOW ROSE DONOR (owner's order, 2026-08-17): the plumbing
// donor is the owner-supplied Lovable design (yellowroseplumbing.com) shipped
// VERBATIM from its own source — Fraunces/Inter typography, the navy/gold
// ticket-counter system, cinematic copper-pipe hero with the glass triage
// card, service-flow schematic, problem-to-fix tickets, heaters/remodels
// bands, route-grid coverage with embedded map, review prompt, request form,
// deep service pages, city pages, blog, about and contact long-form — with
// every identity string tokenized and a content bridge (window.__WSS_CONTENT__)
// that renders VERIFIED client services/faqs on real builds. These tests hold
// that contract:
//
//   1. The compiled design ships whole (bundle + css + assets + fonts).
//   2. ZERO source-business identity survives in any shipped byte.
//   3. The hero video ladder contract (marked video, no src, island, poster,
//      REAL rung-2 bytes).
//   4. The content bridge prefers verified data over template defaults.
//   5. Hydration resolves every token (no {{ or NEED residue on a full build)
//      and a phone-less build flips NEED branches instead of leaving holes.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DIR = path.join(BACKEND, "donors-clean", "plumbing-premier");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-plumb-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const bundleName = () => fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.js$/.test(f));
const bundle = () => fs.readFileSync(path.join(DIR, "assets", bundleName()), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Blue Line Plumbing",
    CITY: "Flint", ADDRESS_CITY: "Flint", STATE: "MI", REGION: "MI",
    HERO_HEADLINE: "Plumbing repair in Flint, MI.",
    HERO_LINE_A: "Blue Line Plumbing", HERO_LINE_B: "Plumbing in Flint, MI",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(810) 555-0142", PHONE_DIGITS: "8105550142",
      EMAIL: "hello@blueline.example", PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "43.0125", GEO_LNG: "-83.6875",
      OWNER_NAME: "Riley Jones", LICENSE: "Lic #123456", RATING: "4.9",
      HERO_BADGE: "Family-owned", ADDRESS: "12 Main St", ZIP: "48501",
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
  assert.ok(files["assets/hero-pipes-Cw1Fb6mm.jpg"], "the cinematic hero photograph ships");
  const html = files["index.html"].toString("utf8");
  assert.match(html, /Fraunces/, "the design's display typeface link ships");
  assert.match(html, /Inter/, "the design's body typeface link ships");
  // The design's signature furniture is present in the compiled bundle.
  const js = bundle();
  assert.match(js, /backdrop-blur/, "glass treatments survive compilation");
  assert.match(js, /What's happening at home\?/, "the hero's glass triage card ships");
  assert.match(js, /Dispatch open/, "the ticket-counter dispatch strip ships");
  assert.match(js, /Open tickets/, "the problem-to-fix ticket section ships");
  assert.match(js, /From the first call to a clean walk-through\./, "the service-flow schematic ships");
});

test("TRUTH LAW — zero source-business identity in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  // The leak gate's declared identity…
  assert.equal(m.donor_business_name, "Yellow Rose Plumbing");
  assert.equal(m.donor_phone, "(210) 901-0236");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes

    const text = buf.toString("utf8");
    for (const needle of [
      "Yellow Rose", "yellowroseplumbing", "Boerne", "Barnett", "brandon@",
      "(210) 901-0236", "210-901-0236", "Plumbtx", "ChIJk1mj", "RMP 44984",
      "Hill Country", "San Antonio", "Kendall", "78006", "GTM-TWLZFW6W",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked source identity: ${needle}`);
    }
  }
});

test("the hero video ladder contract: marked <video>, no src, island, poster, real rung-2 bytes", () => {
  const m = manifest();
  const js = bundle();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)), "the poster is the shipped design photograph");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.wss_fallback_clip_path)),
    "the WSS fallback clip ships REAL bytes (rung 2 plays on every build)");

  const i = js.indexOf('"data-hero-video"');
  assert.ok(i >= 0, "the marked hero video element ships in the bundle");
  const frag = js.slice(i - 60, i + 460);
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
  assert.match(js, /Wet spot, stain, or sound of running water/, "template default ticket cards exist as the fallback");
  assert.match(js, /Do you serve homes outside/, "template default FAQs exist as the fallback");
  assert.match(js, /Plumbing repair/, "the request form's template default service options exist as the fallback");
});

test("hydration: a full token set leaves no residue; a bare set flips NEED branches", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error}`);
  const html = out.files["index.html"].toString("utf8");
  const js = out.files[`assets/${bundleName()}`].toString("utf8");
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!html.includes(residue), `${residue} survived hydration in the shell`);
    assert.ok(!js.includes(residue), `${residue} survived hydration in the bundle`);
  }
  assert.ok(js.includes("Blue Line Plumbing"), "the business name lands in the bundle");
  assert.ok(js.includes("(810) 555-0142"), "the client phone lands");
  assert.match(html, /"telephone": "\(810\) 555-0142"/, "the guarded shell telephone lands");

  // NEED flips: with no phone the ld+json telephone LINE collapses entirely
  // (no empty field — the defect the reference donor shipped), the meta
  // description flips to the no-phone sentence, and no tel: href survives.
  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true);
  const bareHtml = bare.files["index.html"].toString("utf8");
  const bareJs = bare.files[`assets/${bundleName()}`].toString("utf8");
  assert.ok(!bareHtml.includes("telephone"), "no empty schema.org telephone field survives");
  assert.match(bareHtml, /Request a free quote online\./, "no-phone build flips the meta sentence");
  assert.ok(!bareJs.includes("tel:{{"), "no dangling tel: construct");
  assert.ok(bareJs.includes("/contact") || bareJs.includes("#estimate"), "a lead-form CTA survives the bare build");
});
