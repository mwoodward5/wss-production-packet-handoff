"use strict";

// test/fleet-audit.test.js
//
// THE FLEET AUDITOR'S DETECTORS, PINNED. Each fixture below is a distilled
// version of what the 2026-08-22 manual probe found on live mirrors, so a
// regression in any detector shows up as a red test here — not as a wrong
// score on the owner's scorecard. No network: every detector is pure.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  collectGoogleFontFamilies,
  effectiveDisplayFont,
  detectFonts,
  detectAccent,
  detectHeroText,
  imageCensus,
  detectLogo,
  detectLegalHygiene,
  detectTitleSanity,
  detectHeroVideo,
  scoreSite,
  parseArgs,
  slugFromUrl,
  DEFECTS,
} = require("../scripts/fleet-audit.cjs");

const PAGE = "https://wss-test-fixture-plumbing-las-vegas.wss-ai.com/";

// ---------------------------------------------------------------------------
// FONTS — the Anton/Fraunces donor tell.
// ---------------------------------------------------------------------------

test("font tell: donor stylesheet families are read straight from the href", () => {
  const html = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Fraunces:ital,wght@0,9..144,700&family=Inter:wght@400&display=swap">`;
  assert.deepEqual(collectGoogleFontFamilies(html), ["Anton", "Fraunces", "Inter"]);
});

test("font tell: donor Fraunces as primary display face fails with FONT_DONOR_TELL", () => {
  // What a donor-font site looks like: brand_truth never landed, so the
  // boilerplate's Fraunces is still the first family in --font-display.
  const result = detectFonts({
    html: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Fraunces&display=swap">`,
    cssText: `--font-display:"Fraunces", serif;`,
    expectFonts: null,
  });
  assert.equal(result.status, "fail");
  assert.equal(result.defect, "FONT_DONOR_TELL");
  assert.equal(result.primary, "Fraunces");
  assert.equal(DEFECTS[result.defect].weight, 20);
});

test("fonts: expected client font as primary passes even with donor fallbacks loaded", () => {
  // The healthy new-generation build: client font first, donor second, and
  // (wastefully) the donor Google stylesheet still linked.
  const result = detectFonts({
    html: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Fraunces&display=swap"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora&family=Merriweather&display=swap">`,
    cssText: `--font-display:"Lora", "Fraunces", serif; --font-sans:"Merriweather", sans-serif;`,
    expectFonts: ["Lora", "Merriweather"],
  });
  assert.equal(result.status, "pass");
  assert.equal(result.primary, "Lora");
  assert.ok(result.notes.length === 1 && /donor families still loaded/.test(result.notes[0]));
});

test("fonts: expected font loaded but NOT primary fails with FONT_EXPECTED_MISSING", () => {
  const result = detectFonts({
    html: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora&display=swap">`,
    cssText: `--font-display:"Fraunces", "Lora", serif;`,
    expectFonts: ["Lora"],
  });
  // Fraunces primary loses to the donor tell first — that is the louder defect.
  assert.equal(result.defect, "FONT_DONOR_TELL");
});

test("fonts: donor tell is case/quoting agnostic and reads the var", () => {
  assert.equal(effectiveDisplayFont(`--font-display: 'anton' , sans-serif`), "anton");
  const result = detectFonts({ html: "", cssText: `--font-display:'Anton', sans-serif;`, expectFonts: null });
  assert.equal(result.defect, "FONT_DONOR_TELL");
});

// ---------------------------------------------------------------------------
// ACCENT — expected accent must exist in the CSS in SOME literal form.
// ---------------------------------------------------------------------------

test("accent: hex expectation matches the HSL-triplet form the new build emits", () => {
  // #0074F0 == hsl(213 100% 47%): the mirror CSS declares `--accent: 213 100% 47%`.
  const css = `:root{--accent: 213 100% 47%;}`;
  assert.equal(detectAccent(css, "#0074F0").status, "pass");
  assert.equal(detectAccent(`:root{--accent:#1A3047;}`, "#1a3047").status, "pass");
  assert.equal(detectAccent(`:root{--accent:rgb(26, 48, 71);}`, "#1A3047").status, "pass");
});

test("accent: wrong accent in CSS fails with ACCENT_MISSING and names what it found", () => {
  const result = detectAccent(`:root{--accent:#1A3047;}`, "#E5484D");
  assert.equal(result.status, "fail");
  assert.equal(result.defect, "ACCENT_MISSING");
  assert.equal(result.dominant, "#1A3047");
});

test("accent: no expectation auto-notes the dominant accent instead of failing", () => {
  const result = detectAccent(`:root{--accent: 213 100% 38%;}`, null);
  assert.equal(result.status, "note");
  assert.match(result.notes[0], /auto-noted dominant accent: 213 100% 38%/);
});

// ---------------------------------------------------------------------------
// HERO — present/not-empty.
// ---------------------------------------------------------------------------

test("hero: server-rendered h1 with copy passes", () => {
  const html = `<h1>Professional Plumbing in Las Vegas. Canyon Plumbing.</h1>`;
  const result = detectHeroText(html);
  assert.equal(result.status, "pass");
  assert.equal(result.source, "h1");
});

test("hero-empty: an h1 slot with no text is the worst case", () => {
  const html = `<body><header><h1><span></span></h1></header><title>Fixtures</title></body>`;
  const result = detectHeroText(html);
  assert.equal(result.status, "fail");
  assert.equal(result.defect, "HERO_EMPTY");
  assert.equal(DEFECTS.HERO_EMPTY.weight, 15);
});

test("hero: SPA shell with no h1 but a real title warns HERO_TITLE_ONLY", () => {
  // The new-generation mirror mounts the hero with React; statically only the
  // <title> carries the headline. Not a defect to fix blind — but it must be
  // visible on the scorecard.
  const html = `<head><title>Canyon Plumbing LLC — Plumbing in Las Vegas, NV</title></head><body><div id="root"></div></body>`;
  const result = detectHeroText(html);
  assert.equal(result.status, "warn");
  assert.equal(result.defect, "HERO_TITLE_ONLY");
});

test("hero: no h1 AND no title fails empty", () => {
  assert.equal(detectHeroText(`<body><div id="root"></div></body>`).defect, "HERO_EMPTY");
});

// ---------------------------------------------------------------------------
// IMAGE CENSUS — dedup violations + first client-bank position.
// ---------------------------------------------------------------------------

// A page whose photo bank is the client's own domain (their CDN), plus GBP
// photos on lh3. Avatars (-ba2 crop) are NOT client photos.
const CLIENT_PHOTO = "https://fixtureplumbing.com/wp-content/uploads/2025/08/truck.jpg";
const GBP_PHOTO = "https://lh3.googleusercontent.com/a-/ALV-UjXGBP=w1200-h800";

function imgPage(pairs) {
  // pairs: [{src, padKb}] — pad with comment bytes so offsets are meaningful.
  let html = `<html><head><title>Fixture Plumbing — Plumbing in Las Vegas</title></head><body>`;
  for (const { src, padKb = 0 } of pairs) {
    if (padKb) html += `<!--${"p".repeat(padKb * 1024)}-->`;
    html += `<img src="${src}" alt="photo">`;
  }
  html += `</body></html>`;
  return html;
}

test("image census: counts totals and unique srcs", () => {
  const census = imageCensus(imgPage([
    { src: CLIENT_PHOTO },
    { src: GBP_PHOTO },
    { src: CLIENT_PHOTO },
  ]), PAGE, 48);
  assert.equal(census.total, 3);
  assert.equal(census.unique, 2);
});

test("dedup violation: the same src served twice is flagged with its count", () => {
  // The Aug-22 gallery duplication defect: one URL painted into 2+ slots.
  const census = imageCensus(imgPage([
    { src: CLIENT_PHOTO },
    { src: GBP_PHOTO },
    { src: CLIENT_PHOTO },
    { src: CLIENT_PHOTO },
  ]), PAGE, 48);
  assert.equal(census.duplicates.length, 1);
  assert.equal(census.duplicates[0].src, CLIENT_PHOTO);
  assert.equal(census.duplicates[0].count, 3);
});

test("dedup violation: relative and absolute forms of the same asset dedup together", () => {
  const census = imageCensus(
    `<img src="/assets/gallery-1.jpg"><img src="https://wss-test-fixture-plumbing-las-vegas.wss-ai.com/assets/gallery-1.jpg">`,
    PAGE,
    48,
  );
  assert.equal(census.total, 2);
  assert.equal(census.unique, 1);
  assert.equal(census.duplicates[0].count, 2);
});

test("first client image HIGH: client photo near the top of the HTML", () => {
  const census = imageCensus(imgPage([
    { src: CLIENT_PHOTO },
    { src: GBP_PHOTO, padKb: 60 },
  ]), PAGE, 48);
  assert.equal(census.firstClientImage.src, CLIENT_PHOTO);
  assert.equal(census.firstClientImage.position, "high");
});

test("low-first-image: client photo buried under 80kB of boilerplate", () => {
  // What the probe actually caught: the page leads with AI hero CGI and stock,
  // and the client's own photos only show up deep in the markup.
  const census = imageCensus(imgPage([
    { src: "/assets/hero-cgi-flagship-Dla.jpg", padKb: 0 },
    { src: CLIENT_PHOTO, padKb: 80 },
  ]), PAGE, 48);
  assert.ok(census.firstClientImage);
  assert.equal(census.firstClientImage.position, "low");
  assert.ok(census.firstClientImage.offsetKb > 48);
});

test("image census: avatars and mirror-owned CGI never count as client-bank", () => {
  const census = imageCensus(imgPage([
    { src: "https://lh3.googleusercontent.com/a-/ALV-UjX=s128-c0x00000000-cc-rp-mo-ba2" },
    { src: "/assets/hero-fallback-plumbing-clean.jpg" },
    { src: "https://wss-test-fixture-plumbing-las-vegas.wss-ai.com/assets/team.svg" },
  ]), PAGE, 48);
  assert.equal(census.firstClientImage, null);
});

test("image census: GBP photos (non-avatar crops) DO count as client-bank", () => {
  const census = imageCensus(imgPage([{ src: GBP_PHOTO }]), PAGE, 48);
  assert.equal(census.firstClientImage.src, GBP_PHOTO);
});

// ---------------------------------------------------------------------------
// LOGO
// ---------------------------------------------------------------------------

test("logo: og:image pointing at brand-logo counts", () => {
  const html = `<meta property="og:image" content="https://wss-test-fixture-plumbing-las-vegas.wss-ai.com/assets/brand-logo.svg">`;
  assert.equal(detectLogo(html).status, "pass");
});

test("logo: classed img counts; nothing logo-like fails LOGO_MISSING", () => {
  assert.equal(detectLogo(`<img class="site-logo" src="/assets/logo.png">`).status, "pass");
  const missing = detectLogo(`<img class="wss-t__f" src="https://lh3.googleusercontent.com/x=s128-c0x00000000-cc-rp-mo-ba2">`);
  assert.equal(missing.status, "fail");
  assert.equal(missing.defect, "LOGO_MISSING");
});

// ---------------------------------------------------------------------------
// LEGAL HYGIENE — noindex + attribution footer (missing footer is pinned).
// ---------------------------------------------------------------------------

const HYGIENE_GOOD = `<meta name="robots" content="max-image-preview:large, max-snippet:-1, noindex, nofollow" />
<footer class="wss-attr" data-wss-attribution="v1">Unofficial concept by <a href="mailto:support@woodwardsoftware.com">WSS Labs</a></footer>`;

test("legal hygiene: noindex + wss-attr footer passes", () => {
  const result = detectLegalHygiene(HYGIENE_GOOD);
  assert.equal(result.status, "pass");
  assert.equal(result.noindex, true);
  assert.equal(result.attribution, true);
});

test("missing footer: noindex alone fails on the attribution side", () => {
  // The exact live format: robots meta with noindex, but the wss-attr footer
  // never shipped — the second legal hygiene mark.
  const html = `<head><meta name="robots" content="noindex, nofollow" /></head><body><footer>© Fixture Plumbing</footer></body>`;
  const result = detectLegalHygiene(html);
  assert.equal(result.noindex, true);
  assert.equal(result.attribution, false);
  assert.equal(result.status, "fail");
  assert.match(result.notes.join(" "), /no WSS attribution footer/);
});

test("missing noindex: footer alone fails too", () => {
  const html = `<head></head><body>${`<footer class="wss-attr">Unofficial concept by WSS Labs</footer>`}</body>`;
  const result = detectLegalHygiene(html);
  assert.equal(result.noindex, false);
  assert.equal(result.attribution, true);
  assert.equal(result.status, "fail");
});

// ---------------------------------------------------------------------------
// TITLE SANITY + HERO VIDEO
// ---------------------------------------------------------------------------

test("title sanity: placeholder titles fail, real ones pass", () => {
  assert.equal(detectTitleSanity(`<title>Vite App</title>`).defect, "TITLE_UNSANE");
  assert.equal(detectTitleSanity(`<title>404</title>`).defect, "TITLE_UNSANE");
  assert.equal(detectTitleSanity(`<title></title>`).defect, "TITLE_UNSANE");
  assert.equal(detectTitleSanity(`<title>Fixture Plumbing — Plumbing in Las Vegas, NV</title>`).status, "pass");
});

test("hero video: ladder JSON with only the WSS fallback is present-but-noted", () => {
  const html = `<script type="application/json" id="hero-video-ladder">{"sources":["assets/hero-fallback-plumbing-clean.mp4"]}</script>`;
  const result = detectHeroVideo(html);
  assert.equal(result.status, "warn");
  assert.equal(result.clientClip, null);
  assert.match(result.notes[0], /only the WSS fallback/);
});

test("hero video: a client clip in the ladder is a clean pass; no ladder and no video fails", () => {
  const withClip = detectHeroVideo(`<script type="application/json" id="hero-video-ladder">{"sources":["assets/clip-8f2-place-prospects.mp4","assets/hero-fallback-plumbing-clean.mp4"]}</script>`);
  assert.equal(withClip.status, "pass");
  assert.ok(withClip.clientClip);
  assert.equal(detectHeroVideo(`<html><body></body></html>`).defect, "HERO_VIDEO_MISSING");
});

// ---------------------------------------------------------------------------
// SCORING — the scorecard math, end to end on a fixture site.
// ---------------------------------------------------------------------------

function siteFixture(overrides = {}) {
  return {
    url: PAGE,
    slug: "fixture-plumbing-las-vegas",
    checks: {
      fonts: { status: "pass", notes: [] },
      accent: { status: "note", notes: ["auto-noted dominant accent: 199 89% 48%"] },
      hero: { status: "pass" },
      images: { duplicates: [], firstClientImage: { position: "high" } },
      logo: { status: "pass" },
      hygiene: { noindex: true, attribution: true },
      title: { status: "pass" },
      video: { status: "warn", notes: ["ladder carries only the WSS fallback: assets/hero-fallback-plumbing-clean.mp4"] },
      ...overrides,
    },
  };
}

test("scoring: a clean site scores 100", () => {
  const { score, rows } = scoreSite(siteFixture());
  assert.equal(score, 100);
  assert.equal(rows.filter((r) => r.deduction > 0).length, 0);
});

test("scoring: the full Aug-22 defect stack (donor fonts + dup gallery + missing footer) lands under 60", () => {
  const { score, rows } = scoreSite(siteFixture({
    fonts: { status: "fail", defect: "FONT_DONOR_TELL", notes: [] },
    images: { duplicates: [{ src: CLIENT_PHOTO, count: 3 }], firstClientImage: null },
    hygiene: { noindex: true, attribution: false },
  }));
  // 20 (fonts) + 10 (dedup) + 10 (no client photo) + 10 (footer) = 50.
  assert.equal(score, 50);
  const checks = rows.filter((r) => r.deduction > 0).map((r) => r.check.replace(/\s*\(.*/, ""));
  assert.deepEqual(checks.sort(), ["ATTRIBUTION_MISSING", "FONT_DONOR_TELL", "IMG_DUPLICATED", "IMG_NO_CLIENT_PHOTO"]);
});

test("scoring: a fetch failure scores 0 without crashing the report", () => {
  const { score } = scoreSite({ url: PAGE, slug: "x", fetchError: "GET -> 502" });
  assert.equal(score, 0);
});

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

test("parseArgs: expectations by flag and by sidecar map, urls pass through", () => {
  const opts = parseArgs([
    "https://a.example/",
    "--expect-fonts", "canyon-plumbing-llc-las-vegas=Lora,Merriweather",
    "--expect-accent", "canyon-plumbing-llc-las-vegas=#0074F0",
  ]);
  assert.deepEqual(opts.urls, ["https://a.example/"]);
  assert.deepEqual(opts.expects["canyon-plumbing-llc-las-vegas"].fonts, ["Lora", "Merriweather"]);
  assert.equal(opts.expects["canyon-plumbing-llc-las-vegas"].accent, "#0074F0");
});

test("slugFromUrl: reads the slug out of the wss-test host pattern", () => {
  assert.equal(slugFromUrl("https://wss-test-canyon-plumbing-llc-las-vegas.wss-ai.com/"), "canyon-plumbing-llc-las-vegas");
});
