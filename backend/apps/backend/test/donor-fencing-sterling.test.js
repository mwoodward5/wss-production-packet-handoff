"use strict";

// test/donor-fencing-sterling.test.js
//
// THE FENCING VERTICAL'S PRIMARY DONOR (fencing-sterling), rebuilt 2026-09-02
// as a fictional-identity static template by the Lovable a-plus lane: one
// hand-authored index.html (ceder-green slab hero with grain, ticker, bento
// services, SVG gallery, numeral process rail, about, review cards, glass
// FAQ, estimate CTA panel, footer + floater), one hand-authored stylesheet on
// --wss-* properties, one hero-layer bundle, and the verbatim port's 20-page
// fence-guides hub retained. These tests hold that contract:
//
//   1. The static design ships whole (page + css + svg slots + hero bundle
//      + fallback clip + guides hub).
//   2. ZERO template-identity atoms survive in any shipped byte (every
//      identity string is a token; the demo identity lives only in the
//      manifest for the identity gate).
//   3. The hero video ladder contract (marked mount in the bundle, island,
//      walker, kill-switch + paint-under CSS).
//   4. Hydration resolves every token (no {{ or NEED residue on a full
//      build) and a phone-less build collapses the whole call path while
//      the estimate CTA survives.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DIR = path.join(BACKEND, "donors-clean", "fencing-sterling");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-fence-"));

const { loadDonor } = require("../lib/mirror-engine/donor");
const { hydrate } = require("../lib/mirror-engine/hydrate");
const { ALLOWED_TOKENS } = require("../lib/mirror-engine/tokens");

const manifest = () => JSON.parse(fs.readFileSync(path.join(DIR, "BOILERPLATE.json"), "utf8"));
const heroBundle = () =>
  fs.readFileSync(path.join(DIR, "assets", "index-fencing-sterling.js"), "utf8");

function tokensFor({ optional }) {
  const tv = {};
  for (const t of ALLOWED_TOKENS) tv[t] = "";
  Object.assign(tv, {
    BUSINESS_NAME: "Ridgeline Fence & Gate",
    CITY: "Tulsa", ADDRESS_CITY: "Tulsa", STATE: "OK", REGION: "OK",
    HERO_HEADLINE: "Fencing in Tulsa, OK",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(918) 555-0142", PHONE_DIGITS: "9185550142",
      EMAIL: "info@example.com", COUNTY: "Osage County",
      LICENSE: "OK-FC-77201", OWNER_NAME: "Marisol Trent",
      PROFILE_URL: "https://maps.google.com/?cid=1", POSTAL: "74103",
      GEO: "36.1540;-95.9928",
    });
  }
  return tv;
}

test("the static design ships whole: page, css, svg slots, hero bundle, fallback clip, guides", () => {
  const { files } = loadDonor(DIR);
  assert.ok(files["index.html"], "the page ships");
  assert.ok(files["assets/style.css"], "the stylesheet ships");
  assert.ok(files["assets/index-fencing-sterling.js"], "the hero bundle ships");
  assert.ok(files["assets/hero-fallback-fencing.mp4"], "the WSS fallback clip ships");
  for (const slot of manifest().photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  assert.ok(files["fence-guides/index.html"], "the guides hub ships");
  const guideCount = Object.keys(files).filter((k) => /^fence-guides\/[^/]+\/index\.html$/.test(k)).length;
  assert.equal(guideCount, 20, "all twenty guide pages ship");
  const html = files["index.html"].toString("utf8");
  // The design's signature furniture is present in the static page.
  assert.match(html, /class="ticker"/, "the services ticker ships");
  assert.match(html, /class="bento"/, "the services bento ships");
  assert.match(html, /class="faq"/, "the glass accordion FAQ ships");
  assert.match(html, /class="floater"/, "the floating CTA ships");
  assert.match(files["assets/style.css"].toString("utf8"), /--wss-accent/, "the stylesheet consumes --wss-* tokens");
});

test("TRUTH LAW — zero template-identity atoms in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  // The manifest's declared demo identity (the identity gate's needles)…
  assert.equal(m.donor_business_name, "Sterling Line Fence Co.");
  const needles = [
    "Sterling Line Fence", "sterlinglinefence.com", "Dana Whitlock",
    "Brookhaven", "Lincoln County", "39601", "MS-FC-40218",
    "6625550148", "662-555-0148", "(662) 555-0148", "662.555.0148", "+16625550148",
    "31.5793", "-90.4407", "maps.example.com/place/sterling-line-fence-co",
  ];
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes
    const text = buf.toString("utf8");
    for (const needle of needles) {
      assert.ok(!text.includes(needle), `${rel} leaked template identity: ${needle}`);
    }
  }
});

test("the hero video ladder contract: marked mount bundle, island, walker, kill-switch", () => {
  const m = manifest();
  const js = heroBundle();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.wss_fallback_clip_path)), "the fallback clip ships");
  assert.ok(!fs.existsSync(path.join(DIR, m.hero_video.client_video_path)),
    "the client rung must stay empty until the engine places a verified client clip");

  // The mount bundle: marked video, hidden, no static src.
  const at = js.indexOf('"data-hero-video"');
  assert.ok(at >= 0, "the marked hero video element ships in the mount bundle");
  const frag = js.slice(at - 60, at + 430);
  assert.match(frag, /hidden:!0/, "the hero video must mount hidden");
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "no static src — a rung arms only when its bytes shipped");

  // The ladder island is data, client rung first.
  const island = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  assert.ok(island, "the ladder island ships");
  const ladder = JSON.parse(island[1]);
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the client's clip outranks the WSS clip");

  // The universal walker runtime, the kill-switch and the paint-under surface.
  assert.match(html, /heroRungs/, "the universal hero-video runtime ships in the shell");
  assert.match(html, /video\[data-hero-video\]\[hidden\]\s*\{\s*display:\s*none !important;\s*\}/);
  assert.match(html, /video\[data-hero-video\]\[data-hero-dead\]\s*\{\s*display:\s*none !important;\s*\}/);
  assert.ok(html.includes("data-wss-hero-fallback"), "the paint-under fallback style block ships");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion never arms the clip");
});

test("the stat strip renders exact values on first paint (no-JS sees the real numbers)", () => {
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");
  // The literal is inside the <b>, the count-up only animates from it under JS.
  assert.match(html, /<b data-count-to="4\.9" data-suffix="">4\.9<\/b>/, "the rating stat renders 4.9 literally");
  assert.match(html, /<b data-count-to="48" data-suffix="hr">48<\/b>/, "the turnaround stat renders 48 literally");
  assert.match(html, /<b data-count-to="15" data-suffix="yr">15<\/b>/, "the warranty stat renders 15 literally");
});

test("hydration: a full token set leaves no residue; a phone-less build collapses the call path", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error} ${JSON.stringify(out.detail || "").slice(0, 400)}`);
  const html = out.files["index.html"].toString("utf8");
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!html.includes(residue), `${residue} survived hydration in the shell`);
  }
  assert.ok(html.includes("Ridgeline Fence & Gate"), "the business name lands");
  assert.ok(html.includes("(918) 555-0142"), "the client phone lands");
  assert.match(html, /"telephone": "\(918\) 555-0142"/, "the guarded ld+json telephone lands");

  // A phone-less build: no empty tel: href, no dangling "+1", no empty
  // schema telephone — and the estimate CTA still converts.
  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true, `phone-less hydration failed: ${bare.error} ${JSON.stringify(bare.detail || "").slice(0, 400)}`);
  const isText = (rel) => /\.(html|js|css|json|txt|xml|svg|webmanifest)$/i.test(rel);
  for (const [rel, buf] of Object.entries(bare.files)) {
    if (!isText(rel)) continue;
    const s = buf.toString("utf8");
    assert.ok(!/href\s*[:=]\s*(["'`])tel:\1/.test(s), `${rel}: empty tel: href after phone collapse`);
    assert.ok(!/["'`]\+1["'`]/.test(s), `${rel}: a bare "+1" is a phone that lost its digits`);
    assert.ok(!/"telephone"\s*:\s*""/.test(s), `${rel}: empty schema.org telephone`);
  }
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Request a written estimate online\./, "no-phone build flips the meta sentence");
  assert.match(bareHtml, /Get an estimate/, "no-phone build swaps the header CTA to the estimate anchor");
  const all = Object.entries(bare.files).filter(([rel]) => isText(rel)).map(([, b]) => b.toString("utf8")).join("\n");
  assert.match(all, /#contact/, "the estimate CTA survives a phone-less build");
});
