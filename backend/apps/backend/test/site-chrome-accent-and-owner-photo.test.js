"use strict";
// test/site-chrome-accent-and-owner-photo.test.js
//
// THE MIRROR WEARS THE WRONG COLOUR (owner, 2026-08-12, Family Heating): their
// site is blue-dominant, their logo contains a red, and the mirror opened
// pinkish-red because brand.accent keyed on the logo's dominant saturated
// colour unopposed. These tests pin the fix's three parts:
//   1. brand-assets weighs brand.site_accent against the logo's colour — the
//      site wins the PRIMARY accent when the two are different hue families,
//      and the logo colour steps down to the secondary PAINT role (never the
//      surface tint);
//   2. the design brief ranks a recurring human portrait IDENTITY-CRITICAL
//      and leads the carry-over list with it;
//   3. the hero wash prefers their CURRENT hero image, then the portrait,
//      then the best hero-grade photo — and the lane's bank flagging can only
//      ever mark rows that are already ownership-gated bank rows.

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveBrandAssets } = require("../lib/mirror-engine/brand-assets");
const { pickHeroPhoto } = require("../lib/hero-wash");
const { briefFromMeasurement, applyVision } = require("../lib/design-brief");
const { briefSiteAccent, briefFlaggedBank } = require("../lib/mirror-lane-build");

// ---------------------------------------------------------------------------
// 1. the accent decision — site chrome vs logo
// ---------------------------------------------------------------------------
// No brand.logo in any of these, so resolveBrandAssets never opens a socket:
// the caller-supplied accent stands in for the logo's measured colour, which
// is exactly the shape the packet lane sends (the miner measured the logo).

test("different hue families: the site chrome wins primary, the logo colour becomes secondary", async () => {
  const out = await resolveBrandAssets({
    accent: "#C53F34", // the logo's red
    accent_source: "https://client.example/logo.png",
    site_accent: "#0B5CAB", // the blue their site actually wears
    site_accent_source: "https://client.example/",
  });
  assert.equal(out.ok, true);
  assert.equal(out.accent, "#0B5CAB");
  assert.match(out.accent_origin, /site_chrome_over_logo/);
  assert.equal(out.secondary_accent, "#C53F34");
  assert.equal(out.accent_decision.winner, "site_chrome");
  assert.equal(out.accent_decision.logo, "#C53F34");
  assert.ok(out.accent_decision.hue_gap >= 40, `hue gap ${out.accent_decision.hue_gap}`);
  // The demoted colour must NOT land in `primary` — primary drives the
  // page-wide surface tint, which would repaint the paper pinkish-red again.
  assert.notEqual(out.primary, "#C53F34");
});

test("same hue family: the logo keeps the accent — it is the sharper measurement of the same colour", async () => {
  const out = await resolveBrandAssets({
    accent: "#0C5EA8",
    accent_source: "https://client.example/logo.png",
    site_accent: "#1B7D9F", // teal-blue, same family
    site_accent_source: "https://client.example/",
  });
  assert.equal(out.accent, "#0C5EA8");
  assert.equal(out.secondary_accent, undefined);
  assert.equal(out.accent_decision.winner, "logo");
  assert.match(out.accent_decision.why, /same hue family/);
});

test("a near-neutral site chrome never dethrones a saturated logo", async () => {
  const out = await resolveBrandAssets({
    accent: "#C53F34",
    accent_source: "https://client.example/logo.png",
    site_accent: "#8A8D91", // grey chrome
    site_accent_source: "https://client.example/",
  });
  assert.equal(out.accent, "#C53F34");
  assert.equal(out.accent_decision.winner, "logo");
  assert.match(out.accent_decision.why, /near-neutral/);
});

test("no logo colour at all: the site chrome fills, and says so", async () => {
  const out = await resolveBrandAssets({
    site_accent: "#0B5CAB",
    site_accent_source: "https://client.example/",
  });
  assert.equal(out.accent, "#0B5CAB");
  assert.match(out.accent_origin, /site_chrome/);
  assert.equal(out.accent_decision.winner, "site_chrome");
});

test("a site accent without a source URL is not evidence and decides nothing", async () => {
  const out = await resolveBrandAssets({
    accent: "#C53F34",
    accent_source: "https://client.example/logo.png",
    site_accent: "#0B5CAB",
  });
  assert.equal(out.accent, "#C53F34");
  assert.equal(out.accent_decision, undefined);
});

test("a denylisted site_accent_source refuses the build like every other brand URL", async () => {
  const out = await resolveBrandAssets({
    site_accent: "#0B5CAB",
    site_accent_source: "https://facebook.com/somepage",
  });
  assert.equal(out.ok, false);
  assert.equal(out.error, "brand_asset_rejected");
  assert.ok(out.detail.some((d) => d.path === "/brand/site_accent_source"));
});

// ---------------------------------------------------------------------------
// 2. the hero wash photo preference
// ---------------------------------------------------------------------------

test("their CURRENT hero image outranks a larger hero-grade photo", () => {
  const bank = {
    photos: [
      { url: "https://a.com/big.jpg", grade: "hero", width: 1920 },
      { url: "https://a.com/their-hero.jpg", grade: "gallery", width: 1100, current_hero: true },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://a.com/their-hero.jpg");
});

test("a tiny current-hero match cannot carry the wash; the identity portrait is next", () => {
  const bank = {
    photos: [
      { url: "https://a.com/thumb.jpg", grade: "thumbnail", width: 400, current_hero: true },
      { url: "https://a.com/owner.jpg", grade: "hero", width: 1400, identity_critical: true },
      { url: "https://a.com/roof.jpg", grade: "hero", width: 1920 },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://a.com/owner.jpg");
});

test("a stock-caption suspect is never the wash, whatever flags it wears", () => {
  const bank = {
    photos: [
      { url: "https://a.com/stocky.jpg", grade: "hero", width: 1920, current_hero: true, stock_caption_suspect: true },
      { url: "https://a.com/real.jpg", grade: "hero", width: 1600 },
    ],
  };
  assert.equal(pickHeroPhoto(bank).url, "https://a.com/real.jpg");
});

// ---------------------------------------------------------------------------
// 3. the design brief: a recurring human portrait is IDENTITY-CRITICAL
// ---------------------------------------------------------------------------

function syntheticEvidence() {
  return {
    url: "https://client.example/",
    finalUrl: "https://client.example/",
    pixelSurface: "#FFFFFF",
    pixelShare: 0.6,
    measured: {
      viewport: { width: 1280, height: 800 },
      docHeight: 2400,
      title: "Family Heating & Air Conditioning",
      bodySurface: "#FFFFFF",
      backgrounds: { "#FFFFFF": 900000 },
      textColors: { "#111111": 6000 },
      borderColors: {},
      chromaAreas: {},
      fontStats: {},
      actionFills: { "#0B5CAB": { area: 12000, count: 4, labels: ["Call Now"] } },
      actionInks: {},
      loudCandidates: [],
      images: [
        {
          url: "https://client.example/owner-hero.jpg", kind: "img", alt: "the owner at a furnace",
          naturalWidth: 1600, naturalHeight: 900, renderedWidth: 1280, renderedHeight: 720,
          renderedArea: 921600, x: 0, y: 0, inFirstViewport: true, logoLike: false,
        },
        {
          url: "https://client.example/van.jpg", kind: "img", alt: "service van",
          naturalWidth: 800, naturalHeight: 600, renderedWidth: 400, renderedHeight: 300,
          renderedArea: 120000, x: 0, y: 1400, inFirstViewport: false, logoLike: false,
        },
      ],
      logoCandidates: [],
      visibleText: ["Family Heating & Air Conditioning keeps Lawrence comfortable"],
      elementCount: 120,
      truncatedElements: false,
    },
    mobileMeasured: {
      images: [{ url: "https://client.example/owner-hero.jpg" }],
    },
  };
}

test("an owner portrait that is their hero on desktop AND mobile is promoted and leads the carry-over", () => {
  const base = briefFromMeasurement(syntheticEvidence(), { businessName: "Family Heating & Air Conditioning" });
  assert.deepEqual(base.measurements.mobileImageUrls, ["https://client.example/owner-hero.jpg"]);
  const brief = applyVision(base, {
    temperature: "cool",
    character: "family-run",
    hero_image_index: 0,
    identity_images: [
      { index: 0, what: "owner", confidence: 0.9 },
      { index: 1, what: "van", confidence: 0.8 },
    ],
    filler_images: [],
    carry_over: [],
    loud_elements: [],
  }, { visibleText: base.measurements ? ["Family Heating & Air Conditioning keeps Lawrence comfortable"] : [] });

  const lead = brief.identityImages[0];
  assert.equal(lead.url, "https://client.example/owner-hero.jpg");
  assert.equal(lead.what, "owner");
  assert.equal(lead.identityCritical, true);
  assert.match(lead.criticalWhy, /current hero image/);
  assert.match(lead.criticalWhy, /mobile/);
  // The van is theirs but not identity-critical.
  assert.equal(brief.identityImages[1].identityCritical, undefined);
  // The provenance says what happened, and the carry-over checklist leads
  // with the person, anchored to the measured image.
  assert.match(brief.provenance.identityImages.note, /IDENTITY-CRITICAL/);
  assert.equal(brief.carryOver[0].anchor.url, "https://client.example/owner-hero.jpg");
  assert.match(brief.carryOver[0].what, /owner/);
});

test("a van above the fold is NOT promoted — only a human subject is identity-critical", () => {
  const ev = syntheticEvidence();
  ev.measured.images[1].inFirstViewport = true;
  ev.mobileMeasured.images = [];
  const base = briefFromMeasurement(ev, { businessName: "X" });
  const brief = applyVision(base, {
    hero_image_index: null,
    identity_images: [{ index: 1, what: "van", confidence: 0.9 }],
    loud_elements: [],
    carry_over: [],
  }, { visibleText: [] });
  assert.equal(brief.identityImages.length, 1);
  assert.equal(brief.identityImages[0].identityCritical, undefined);
});

// ---------------------------------------------------------------------------
// 4. the lane's flagging — brief verdicts onto ownership-gated bank rows only
// ---------------------------------------------------------------------------

test("briefSiteAccent reads what the site WEARS: the painted chrome outranks the buttons", () => {
  // familyhvac.net, measured 2026-08-12: chrome 77% white, 13% #005DAC blue,
  // 8% #009EE2 blue, 2% #ED282F red — and the ACTION colour (buttons) is that
  // red. The site-wear colour is the blue band, not the button.
  const brief = {
    accent: "#ED282F",
    finalUrl: "https://www.familyhvac.net/",
    provenance: { accent: { source: "measured", confidence: 0.82 } },
    measurements: {
      surfaceCandidates: [
        { hex: "#FFFFFF", value: 8022484, share: 0.77 },
        { hex: "#005DAC", value: 1394760, share: 0.13 },
        { hex: "#009EE2", value: 826957, share: 0.08 },
        { hex: "#ED282F", value: 167595, share: 0.02 },
      ],
    },
  };
  assert.deepEqual(briefSiteAccent(brief), {
    site_accent: "#005DAC",
    site_accent_source: "https://www.familyhvac.net/",
  });
});

test("with no saturated chrome the action colour is the site-wear fallback, same evidence bar", () => {
  const brief = {
    accent: "#0B5CAB",
    finalUrl: "https://client.example/",
    provenance: { accent: { source: "measured", confidence: 0.85 } },
    measurements: {
      surfaceCandidates: [
        { hex: "#FFFFFF", share: 0.9 },
        { hex: "#111111", share: 0.06 },      // near-black footer: not "worn colour"
        { hex: "#F2F2F2", share: 0.04 },
      ],
    },
  };
  assert.deepEqual(briefSiteAccent(brief), {
    site_accent: "#0B5CAB",
    site_accent_source: "https://client.example/",
  });
  // Below the confidence bar: nothing travels.
  brief.provenance.accent.confidence = 0.4;
  assert.deepEqual(briefSiteAccent(brief), {});
});

test("briefFlaggedBank marks the current hero + portrait rows and front-loads their URLs", () => {
  const bank = {
    photos: [
      { url: "https://c.example/roof.jpg", sha256: "a".repeat(64), grade: "hero", width: 1920, height: 1080, source: "gbp" },
      { url: "https://c.example/owner-hero.jpg", sha256: "b".repeat(64), grade: "hero", width: 1600, height: 900, source: "own_site" },
      { url: "https://c.example/van.jpg", sha256: "c".repeat(64), grade: "gallery", width: 800, height: 600, source: "scraped_by_a_bug" },
    ],
  };
  const brief = {
    heroImage: { url: "https://c.example/owner-hero.jpg" },
    identityImages: [{ url: "https://c.example/owner-hero.jpg", what: "owner", identityCritical: true }],
  };
  const photos = ["https://c.example/roof.jpg", "https://c.example/van.jpg"];
  const out = briefFlaggedBank(bank, brief, photos, 3);
  const rows = out.photo_bank.photos;
  const ownerRow = rows.find((r) => r.url.endsWith("owner-hero.jpg"));
  assert.equal(ownerRow.current_hero, true);
  assert.equal(ownerRow.identity_critical, true);
  assert.equal(rows.find((r) => r.url.endsWith("roof.jpg")).current_hero, undefined);
  // The harvest source travels with the row — pickHeroPhoto prefers the
  // client's own site's photography — but ONLY the two values the ownership
  // gate writes; an unrecognised source never becomes invented provenance.
  assert.equal(ownerRow.source, "own_site");
  assert.equal(rows.find((r) => r.url.endsWith("roof.jpg")).source, "gbp");
  assert.equal(rows.find((r) => r.url.endsWith("van.jpg")).source, undefined);
  // The flagged URL was inserted at the FRONT of the photos list so its bytes
  // are among the fetched.
  assert.equal(photos[0], "https://c.example/owner-hero.jpg");
  assert.ok(photos.length <= 3);

  // A URL that is NOT a bank row can never be flagged into the request: the
  // rows come only from the bank, and the bank only holds ownership-gated
  // photographs (their site or their GBP).
  const stockBrief = { heroImage: { url: "https://stock.example/pretty.jpg" }, identityImages: [] };
  const out2 = briefFlaggedBank(bank, stockBrief, [], 3);
  assert.ok(out2.photo_bank.photos.every((r) => !r.current_hero && !r.identity_critical));
});

// ---------------------------------------------------------------------------
// 5. the engine's wiring — source-shape checks in the pattern hero-wash.test.js
//    already uses for the per-donor gate
// ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

test("the hero wash is a DARK cinematic scrim with a forced-white headline, after the theme pass", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  // The scrim keeps the client's hue — the accent walked from the themed slab…
  assert.match(src, /themePalette \? themePalette\.slab : spec\.background/);
  // …but it is proven against WHITE over a DARK anchor, so the wash goes dark and
  // the client's hero video reads as a moody cinematic scene instead of a pale
  // smother (owner direction 2026-08-13, superseding the themed-slabInk scrim,
  // which proved contrast for a dark ink the headline does not actually paint).
  assert.match(src, /scrimHex: "#0b1220"/);
  assert.match(src, /textHex: "#ffffff"/);
  // The hero ink is painted by hero-wash's own heroTextCss — solid proven
  // inks for headline AND sub-line/reviews line — not by a color-only rule a
  // gradient-text donor (-webkit-text-fill-color: transparent) ignores. The
  // paired proof that the old color-only rule fails lives in hero-wash.test.js.
  assert.match(src, /heroTextCss\(\{ selector: spec\.selector \}\)/);
  // …and the scrim alpha is proven for the dimmer sub ink as well as white.
  assert.match(src, /inkFloorHex: HERO_SUB_INK/);
  // …and the block sits AFTER the theme pass that assigns themePalette.
  assert.ok(src.indexOf("themePalette = palette") < src.indexOf("scrim_basis"), "wash must run after the theme");
  // The demoted logo colour reaches the secondary PAINT role only.
  assert.match(src, /brandOut\.primary \|\| brandOut\.secondary_accent/);
});

test("the mobile fold ships: one line, stars via #trust under the hero, call kept", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  assert.match(src, /wss mobile fold/);
  assert.match(src, /max-width: 640px/);
  // Slogan-led keeps line A; name-led collapses the h1 to its first span.
  assert.match(src, /h1 br, :is\(\$\{sel\}\) h1 br ~ \*/);
  // The name-led collapse evolved (2026-08-17 line): hiding every child and
  // injecting the one-line headline via h1::after guarantees one line on any
  // donor markup, where the old first-span show depended on donor structure.
  assert.match(src, /h1 > \* \{ display: none !important; \}/);
  assert.match(src, /h1::after \{ content:/);
  // The quote CTA hides only when a call CTA is genuinely in the shipped bytes.
  assert.match(src, /data-cta="hero-call"/);
  assert.match(src, /mobile_fold/);
});

// ---------------------------------------------------------------------------
// 6. donor editorial cruft is stripped from every build (owner, on the live
//    Family Heating hvac mirror: "terrible / sloppy" — "S02", "REEL - 043",
//    "FIELD - 58:42", "THE COMFORT DIAL - INTERACTIVE", giant faint watermarks)
// ---------------------------------------------------------------------------

const { stripDonorCruft, appendToLastCss } = require("../lib/mirror-engine/engine");

function hvacPremierBundle() {
  const dir = path.join(__dirname, "..", "donors-clean", "hvac-premier", "assets");
  const jsName = fs.readdirSync(dir).find((f) => /^index-.*\.js$/.test(f));
  assert.ok(jsName, "hvac-premier ships a compiled bundle");
  return { rel: `assets/${jsName}`, bytes: fs.readFileSync(path.join(dir, jsName)) };
}

test("stripDonorCruft blanks the donor's editorial scaffolding on the real hvac bundle", () => {
  const b = hvacPremierBundle();
  const files = { [b.rel]: Buffer.from(b.bytes) };
  const { blanked } = stripDonorCruft(files);
  const after = files[b.rel].toString("utf8");
  assert.ok(blanked > 0, "the magazine donor carries cruft to blank");
  // Every meaningless label the owner named is gone.
  for (const gone of ["Reel · 042", "Field · 18:42", "§ Field card", "The Comfort Dial · Interactive",
    "Ch. 02 — Comfort Dial", "Interactive · §02", "Read time · 12s"]) {
    assert.ok(!after.includes(gone), `donor cruft survived: ${gone}`);
  }
  // Real client-facing content is untouched — the interactive dial's own labels,
  // the feature tags, the service copy.
  for (const keep of ["AC running quiet", "Even, room to room", "Fresh, filtered air"]) {
    assert.ok(after.includes(keep), `real content was destroyed: ${keep}`);
  }
});

test("stripDonorCruft never changes a bundle that carries no editorial scaffolding", () => {
  const clean = { "assets/app.js": Buffer.from('const a={title:"Emergency AC Repair",body:"We fix it fast."};export default a;', "utf8") };
  const before = clean["assets/app.js"].toString("utf8");
  const { blanked } = stripDonorCruft(clean);
  assert.equal(blanked, 0);
  assert.equal(clean["assets/app.js"].toString("utf8"), before, "a donor without cruft is byte-identical");
});

test("blanking a decorative literal keeps the surrounding JS structurally intact", () => {
  const files = { "assets/x.js": Buffer.from('var s={kicker:"How It Works · §03",title:"Real Title"};var t="Reel · 042";', "utf8") };
  stripDonorCruft(files);
  const out = files["assets/x.js"].toString("utf8");
  assert.match(out, /kicker:""/);          // decorative value emptied…
  assert.match(out, /title:"Real Title"/); // …the real one left alone
  assert.match(out, /var t="";/);          // bare badge literal emptied
  // A complete "..." became "" — still a valid literal in the same position.
  assert.doesNotThrow(() => new Function(out));
});

test("appendToLastCss writes to the last-sorted stylesheet and reports the path", () => {
  const files = {
    "assets/a.css": Buffer.from("a{}", "utf8"),
    "assets/z.css": Buffer.from("z{}", "utf8"),
    "index.html": Buffer.from("<html></html>", "utf8"),
  };
  const target = appendToLastCss(files, "/* appended */");
  assert.equal(target, "assets/z.css");
  assert.match(files["assets/z.css"].toString("utf8"), /z\{\}\n\/\* appended \*\//);
  assert.equal(files["assets/a.css"].toString("utf8"), "a{}", "earlier sheets untouched");
  // A donor with no CSS has nowhere to put it, and says so.
  assert.equal(appendToLastCss({ "index.html": Buffer.from("x") }, "/* x */"), null);
});

test("engine wiring: giant watermark hidden for the magazine donor; toggle docked off the mobile header", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mirror-engine", "engine.js"), "utf8");
  // (2) the giant faint section-number watermark is hidden by its exact class,
  //     and only once cruft was actually found (so other donors stay identical).
  assert.match(src, /if \(cruft\.blanked > 0\)/);
  assert.match(src, /\.text-\\\\\[120px\\\\\]\{display:none!important\}/);
  // (3) the light/dark toggle is repositioned off the header on <=640px, gated on
  //     the theme actually being applied (the toggle only exists then).
  assert.match(src, /if \(themeReport\.applied\)/);
  assert.match(src, /@media \(max-width:640px\)\{/);
  assert.match(src, /\.wss-theme-toggle\{top:auto!important;bottom:calc\(86px \+ env\(safe-area-inset-bottom\)\)!important;right:auto!important;left:12px!important;\}/);
  // And it is reported as evidence, not silently done.
  assert.match(src, /checks\.donor_cruft = \{ status: "passed", \.\.\.cruftReport \}/);
});
