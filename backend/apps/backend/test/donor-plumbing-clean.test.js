"use strict";

// test/donor-plumbing-clean.test.js
//
// THE VERBATIM HARTER DISPATCH DONOR (owner's order, 2026-08-17): the plumbing
// donor is the owner-supplied Lovable design (harter_pumping_site_1 — the
// "Liquid Earth" newspaper/brutalist Dispatch: utility ticker, six-layer
// parallax hero with glassmorphism OPS-INSTRUMENT HUD and annotation pins,
// gold dispatch ticker, animated liquid-wave SVG, marquee, drop-cap manifesto,
// three monumental service cards, annotated showcase, field-plate gallery
// mosaic, the three-tool planning workshop, process timeline, region band,
// FAQ ledger, brutalist quote form and colophon footer, plus the five inner
// routes) shipped VERBATIM from its own source — recompiled as a static client
// SPA — with every identity string tokenized and a content bridge
// (window.__WSS_CONTENT__) that renders VERIFIED client services/faqs/areas
// on real builds. These tests hold that contract:
//
//   1. The compiled design ships whole (bundle + css + assets + fonts +
//      distinctive furniture) — and the WSS-owned hero clip ships too.
//   2. ZERO source-business identity survives in any shipped byte.
//   3. The hero video ladder contract (marked video, no src, island, rungs).
//   4. The content bridge prefers verified data over template defaults.
//   5. Hydration resolves every token (no {{ or NEED residue on a full build;
//      a phone-less build flips the call copy to the form).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const DIR = path.join(BACKEND, "donors-clean", "plumbing-clean");

// GATE 4C: never stamp an audit build into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-plumbing-"));

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
    BUSINESS_NAME: "Rimrock Plumbing",
    CITY: "Tucson", ADDRESS_CITY: "Tucson", STATE: "AZ", REGION: "AZ",
    HERO_HEADLINE: "Plumbing done right in Tucson, AZ",
    LOGO_URL: "/assets/brand-logo.svg",
    DOMAIN: "x.wss-ai.com", PREVIEW_DOMAIN: "x.wss-ai.com",
    PREVIEW_URL: "https://x.wss-ai.com/", SITE_URL: "https://x.wss-ai.com/",
  });
  if (optional) {
    Object.assign(tv, {
      PHONE: "(520) 555-0188", PHONE_DIGITS: "5205550188",
      EMAIL: "hello@example.com", ADDRESS: "1 Stone Ave", ZIP: "85701", POSTAL: "85701",
      RATING: "4.8", REVIEW_COUNT: "73",
      PROFILE_URL: "https://maps.google.com/?cid=1",
      GEO_LAT: "32.2226", GEO_LNG: "-110.9747",
    });
  }
  return tv;
}

test("the verbatim design ships whole: bundle, css, design assets, owned clip, fonts", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  assert.ok(files["index.html"], "the shell ships");
  assert.ok(bundleName().endsWith(".js"), "the compiled bundle ships");
  assert.ok(Object.keys(files).some((k) => /^assets\/index-.*\.css$/.test(k)), "the compiled css ships");
  for (const slot of m.photo_slots) {
    assert.ok(files[slot], `design asset ships: ${slot}`);
  }
  // The cinematic hero photograph (poster + always-painted rung) ships.
  assert.ok(files[m.hero_video.poster], "the hero stage photograph ships");
  // The WSS-owned clip is REAL bytes that ship on every build.
  assert.ok(files[m.hero_video.wss_fallback_clip_path], "the WSS-owned hero clip ships");
  const clip = fs.readFileSync(path.join(DIR, m.hero_video.wss_fallback_clip_path));
  assert.ok(clip.length > 100000, `an owned hero clip should carry real bytes (${clip.length})`);
  assert.equal(clip.slice(4, 8).toString("ascii"), "ftyp", "the owned clip must be a real mp4");

  const html = files["index.html"].toString("utf8");
  for (const face of ["Anton", "Fraunces", "Inter", "JetBrains+Mono"]) {
    assert.ok(html.includes(face), `the design's ${face} typeface link ships`);
  }

  // The design's signature furniture is present in the compiled bundle.
  const js = bundle();
  assert.match(js, /OPS-INSTRUMENT/, "the hero's glassmorphism HUD ships");
  assert.match(js, /Drip Meter/, "the workshop's Drip Meter widget ships");
  assert.match(js, /Water Heater Check/, "the workshop's Water Heater Check ships");
  assert.match(js, /Best Time to Schedule/, "the workshop's seasonal planner ships");
  assert.match(js, /Field Plate/, "the gallery's field plates ship");
  assert.match(js, /Leak Repair/, "the giant-type marquee ships");
  // ...and its layer stack in the css.
  const css = fs.readFileSync(path.join(DIR, "assets", fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.css$/.test(f))), "utf8");
  for (const layer of ["glass-plate", "aurora-bg", "marquee-track", "shimmer-text", "grain", "grid-paper"]) {
    assert.ok(css.includes(layer), `the design's ${layer} layer ships`);
  }
});

test("TRUTH LAW — zero source-business identity in any shipped byte", () => {
  const { files } = loadDonor(DIR);
  const m = manifest();
  // The leak gate's declared identity — the REAL source business.
  assert.equal(m.donor_business_name, "Harter Custom Pumping, Inc.");
  assert.equal(m.donor_city, "Dyersville");
  for (const [rel, buf] of Object.entries(files)) {
    if (rel === "BOILERPLATE.json") continue; // the declaration, not shipped page bytes

    const text = buf.toString("utf8");
    for (const needle of [
      "Harter", "harter", "Dyersville", "DYERSVILLE", "Northeast Iowa",
      "563-875-8730", "5638758730", "harters@yousq.net", "yousq.net",
      "hartercustompumping.com", "harper.wss-ai.com",
      "3031 160th", "52040", "42.4844", "91.1232",
      "MCMXCIII", "1993", "thirty-two", "Vol. 32", "Vol. XXXII",
      "Dubuque", "Delaware", "Clayton", "Buchanan", "Fayette",
      "Septic", "septic", "Manure", "manure", "Hwy 136", "LiquidEarth", "HCP-DYE",
      "24/7",
    ]) {
      assert.ok(!text.includes(needle), `${rel} leaked source identity: ${needle}`);
    }
  }
});

test("the hero video ladder contract: marked <video>, no src, island, poster, rungs", () => {
  const m = manifest();
  const js = bundle();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  assert.equal(m.hero_video.expected_asset_kind, "video");
  assert.ok(Array.isArray(m.hero_video.ladder) && m.hero_video.ladder.length >= 4,
    "the documented fallback ladder (client video, WSS clip, photo, drawn) must live in the manifest");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)), "the poster is the shipped design photograph");

  const i = js.indexOf('"data-hero-video"');
  assert.ok(i >= 0, "the marked hero video element ships in the bundle");
  const frag = js.slice(i - 60, i + 430);
  for (const attr of ["autoPlay", "muted", "loop", "playsInline", 'preload:"metadata"', "hidden", "poster"]) {
    assert.ok(frag.includes(attr), `the hero video must carry ${attr}`);
  }
  assert.ok(!/"src":"[^"]*\.mp4"/.test(frag), "no static src — a rung arms only when its bytes shipped");

  // The runtime and its guards live in the shell.
  assert.match(html, /getElementById\("hero-video-ladder"\)/, "the runtime must read the ladder island");
  assert.match(html, /prefers-reduced-motion:\s*reduce/, "reduced motion must never arm the video rungs");
  assert.match(html, /video\[data-hero-video\]/, "the runtime must wait for the SPA-mounted hero video element");
  assert.match(html, /prefers-reduced-motion:\s*reduce\)\s*\{\s*video\[data-hero-video\]\s*\{\s*display:\s*none/,
    "reduced motion must hide the marked video via CSS as well as the runtime guard");

  const island = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
  assert.ok(island, "the ladder island ships");
  const ladder = JSON.parse(island[1]);
  assert.deepEqual(ladder.sources, [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
    "the client's clip outranks the WSS clip");
  assert.equal(m.hero_video.client_video_path, "assets/hero-client-plumbing-clean.mp4");
  assert.equal(m.hero_video.wss_fallback_clip_path, "assets/hero-fallback-plumbing-clean.mp4");
});

test("a clip dropped at a documented rung path ships with no code change", () => {
  const m = manifest();
  const FIXTURE_MP4 = path.join(BACKEND, "test", "fixtures", "mirror-donor", "media", "hero-loop.mp4");
  for (const rung of [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plumbing-clean-hero-video-"));
    const walk = (from, to) => {
      for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const f = path.join(from, e.name);
        const t = path.join(to, e.name);
        if (e.isDirectory()) { fs.mkdirSync(t, { recursive: true }); walk(f, t); }
        else fs.copyFileSync(f, t);
      }
    };
    walk(DIR, tmp);
    try {
      fs.copyFileSync(FIXTURE_MP4, path.join(tmp, rung));
      const { files } = loadDonor(tmp);
      assert.ok(files[rung], "dropping the clip at the documented path IS the deployment");
      assert.deepEqual(files[rung], fs.readFileSync(FIXTURE_MP4));
      const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
      assert.equal(out.ok, true, `hydration failed: ${out.error}`);
      const html = out.files["index.html"].toString("utf8");
      const ladder = html.match(/<script type="application\/json" id="hero-video-ladder"\s*>([\s\S]*?)<\/script>/);
      assert.deepEqual(JSON.parse(ladder[1]).sources,
        [m.hero_video.client_video_path, m.hero_video.wss_fallback_clip_path],
        "the client rung stays above the WSS rung whichever one holds bytes");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("the content bridge prefers verified data over template defaults", () => {
  const js = bundle();
  assert.ok(js.includes("__WSS_CONTENT__"), "the bundle reads the engine's content island");
  // The minifier renames locals; the window property and the template
  // defaults it falls back to are the stable anchors.
  assert.match(js, /Repairs & Fixtures/, "template default services exist as the fallback");
  assert.match(js, /burst or leaking pipe/, "template default faqs exist as the fallback");
  // The inner routes ship as a real SPA route tree.
  for (const route of manifest().spa_routes) {
    assert.ok(js.includes(`"${route}"`) || js.includes(`"${route}/"`), `the ${route} route ships in the router`);
  }
});

test("ZERO-JS HERO LAW (final-qa Class A fix): photo-first stage, no static video, static composed headline", () => {
  const m = manifest();
  const html = fs.readFileSync(path.join(DIR, "index.html"), "utf8");

  // THE SLAB IS GONE. A static source-less <video> behind the drawn
  // placeholder was the empty first viewport on every Class A build: the
  // donor ships NO static <video> element — the video layer exists only
  // when the SPA bundle mounts the ladder-marked element AND a rung's
  // bytes shipped.
  assert.doesNotMatch(html, /<video[\s>]/i, "no static <video> in the shell — the photo-first stage is the hero");
  assert.doesNotMatch(html, /data-desktop-autoplay/, "the desktop-autoplay shell variant is retired");
  // The marked video's CSS underpainting is the donor's REAL photograph,
  // never the drawn placeholder (falcon-family pattern).
  const css = fs.readFileSync(path.join(DIR, "assets", fs.readdirSync(path.join(DIR, "assets")).find((f) => /^index-.*\.css$/.test(f))), "utf8");
  const shellFallback = /<style data-wss-hero-fallback>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(shellFallback, "the hero fallback style block ships");
  assert.match(shellFallback[1], /video\[data-hero-video\]\{background:#0b0f12 url\("assets\/hero-cgi-flagship-Dla_-qtr\.jpg"\)/,
    "the marked video paints the real stage photograph beneath any frame");

  // THE HEADLINE IS STATIC AND THE CLIENT'S OWN. {{HERO_HEADLINE}} (composed
  // per prospect by identity-copy) hydrates into the served bytes — the
  // no-JS first viewport carries the h1 above the fold, no bridge, no
  // prehydration skeleton.
  assert.match(html, /<h1 data-wss-hero-headline>\{\{HERO_HEADLINE\}\}<\/h1>/,
    "the static marked hero headline ships in the shell");
  const hydrated = hydrate({ donorFiles: loadDonor(DIR).files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(hydrated.ok, true, `hydration failed: ${hydrated.error}`);
  const out = hydrated.files["index.html"].toString("utf8");
  assert.match(out, /<h1 data-wss-hero-headline>Plumbing done right in Tucson, AZ<\/h1>/,
    "the composed headline hydrates into the static h1");
  assert.equal((out.match(/<h1[\s>]/gi) || []).length, 1, "exactly one h1 in the hydrated shell");

  // THE ENGINE WIRING: the manifest carries the hero-poster slot (the
  // falcon wiring) so mirror-engine/hero-poster.js re-owns the stage per
  // build — a gated prospect photograph when one qualifies, the manifest's
  // REAL hero_video.poster photograph otherwise — with the compile-time
  // ships assertion over it.
  assert.equal(m.photo_slots[0], "assets/hero-poster.svg",
    "the hero-poster slot is wired as the first photo slot");
  assert.ok(fs.existsSync(path.join(DIR, m.hero_video.poster)), "the manifest poster (real photograph) ships");
  assert.ok(!/\.svg$/i.test(m.hero_video.poster), "the manifest poster is a real photograph, not the drawn placeholder");
  // The stage img falls back to the bundled real photograph — never a
  // second 404 (the onerror-chain defect).
  const heroImg = /<img[^>]*src="assets\/hero-poster\.svg"[^>]*>/.exec(out);
  assert.ok(heroImg, "the hero stage img (the pass's rewrite target) ships");
  assert.match(heroImg[0], /onerror="this\.onerror=null;this\.src='assets\/hero-cgi-flagship-Dla_-qtr\.jpg'"/,
    "the stage img's onerror points at the bundled real photograph");
});

test("hydration: a full token set leaves no residue; identity tokens land; a phone-less build flips the copy", () => {
  const { files } = loadDonor(DIR);
  const out = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: true }) });
  assert.equal(out.ok, true, `hydration failed: ${out.error}`);
  const html = out.files["index.html"].toString("utf8");
  const js = out.files[`assets/${bundleName()}`].toString("utf8");
  for (const residue of ["[[NEED", "[[/NEED", "{{"]) {
    assert.ok(!html.includes(residue), `${residue} survived hydration in the shell`);
  }
  // The bundle check is TOKEN-SHAPED, not raw "{{": this donor compiles the
  // TanStack Router, whose minified lazyFn body is `=>{{const{id:p,...x}` —
  // an arrow block inside an arrow block, legitimate braces that are not a
  // token. An unsubstituted {{TOKEN}} is still caught; furniture braces are not.
  assert.doesNotMatch(js, /\{\{[A-Z0-9_]+\}\}/, "a token survived hydration in the bundle");
  assert.ok(!js.includes("[[NEED"), "[[NEED survived hydration in the bundle");
  assert.ok(js.includes("Rimrock Plumbing"), "the business name lands in the bundle");
  assert.ok(js.includes("(520) 555-0188"), "the client phone lands");
  assert.ok(html.includes("Call (520) 555-0188."), "the shell meta carries the phone sentence");
  // The guarded ld+json telephone property flipped in whole, comma included.
  assert.ok(html.includes('"telephone": "(520) 555-0188"'), "the guarded schema telephone lands");
  assert.ok(html.includes('"streetAddress": "1 Stone Ave"'), "the guarded schema street address lands");

  const bare = hydrate({ donorFiles: files, tokenValues: tokensFor({ optional: false }) });
  assert.equal(bare.ok, true);
  const bareHtml = bare.files["index.html"].toString("utf8");
  assert.match(bareHtml, /Request a quote online\./, "no-phone build flips the meta sentence");
  assert.ok(!bareHtml.includes("telephone"), "no-phone build drops the schema telephone property whole");
  assert.ok(!bareHtml.includes('"streetAddress": ""'), "no empty structured-data streetAddress");
  const bareJs = bare.files[`assets/${bundleName()}`].toString("utf8");
  assert.ok(!/"telephone"\s*:\s*""/.test(bareHtml), "no empty structured-data telephone");
});
