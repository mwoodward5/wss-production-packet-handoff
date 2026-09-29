"use strict";
// test/brand-extractor.test.js — lib/brand-extractor against the site that
// started it: Hurricane Fence's plain WordPress homepage, saved live to
// test/fixtures/hurricane-fence.html. The mirror shipped in the fencing-sterling
// donor's navy-and-gold because the old paths needed a measurable logo raster
// (theirs is a WebP) or CSS custom properties in a shape nobody read. The
// fixture MUST yield #E31E24 and screenshot.webp — if it stops, the failure is
// back.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const extractor = require("../lib/brand-extractor");
const theme = require("../lib/mirror-engine/theme");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const miner = require("../lib/lead-miner");

const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "hurricane-fence.html"), "utf8");
const FIXTURE_URL = "https://www.hurricanefenceinc.com/";

const identity = (input) => extractor.extractBrandIdentity(input);

test("Hurricane Fence fixture: the red accent, the WebP logo, the white paper", async () => {
  const got = await identity({ html: FIXTURE, baseUrl: FIXTURE_URL });

  // THE accent — 8 occurrences across the site's own <style> blocks and
  // style="" attributes, the exact count the owner measured live.
  assert.equal(got.accent_color, "#E31E24");
  assert.equal(got.signals.accent_count, 8);

  // The logo the mirror shipped without.
  assert.equal(got.logo_url, "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp");

  // theme-color is #ffffff — the paper, not an accent.
  assert.equal(got.background, "#FFFFFF");

  // White theme-color corroborates nothing, so CSS analysis alone: MEDIUM.
  assert.equal(got.confidence, "MEDIUM");
  assert.equal(got.extraction_method, "css_frequency");

  // The secondary is a genuinely different hue family (their dark blue), not a
  // shade of the red.
  assert.ok(got.secondary_color, "secondary_color should exist");
  assert.notEqual(got.secondary_color, got.accent_color);
  const secondaryHue = theme.hexToHsl(got.secondary_color).h;
  assert.ok(secondaryHue >= 180 && secondaryHue <= 260, `secondary hue ${secondaryHue} should be blue-family`);
});

test("Hurricane Fence fixture: HTML entities are never promoted to brand colours", async () => {
  const got = await identity({ html: FIXTURE, baseUrl: FIXTURE_URL });
  // `Fences &#038; Decks` — a naive /#[0-9a-f]{3,8}/ reads the ampersand
  // entity as the colour #038 (-> #003388). The site's blue must be a real
  // CSS colour, never this artefact.
  assert.notEqual(got.secondary_color, "#003388");
  assert.notEqual(got.accent_color, "#003388");

  const minimal = await identity({
    html: `<html><body><p>Rocks &#038; Rolls &#x2654; fine</p>
      <style>.a{color:#111111}.b{background:#1D4ED8}</style></body></html>`,
    baseUrl: "https://example.com/",
  });
  assert.notEqual(minimal.accent_color, "#003388");
  assert.equal(minimal.accent_color, "#1D4ED8");
});

test("a CSS-custom-properties site with an agreeing theme-color scores HIGH", async () => {
  const html = `<html><head>
    <meta name="theme-color" content="#c8102e">
    <style>
      :root { --accent: #c8102e; --primary: #1a1a2e; --background: #ffffff; }
      .btn { background-color: var(--accent); color: #ffffff; }
      .link { color: #c8102e; }
      .muted { color: #6b7280; }
    </style></head>
    <body><img class="custom-logo" src="/media/logo.svg" alt="Acme logo"></body></html>`;
  const got = await identity({ html, baseUrl: "https://acme.example.com/" });
  assert.equal(got.accent_color, "#C8102E");
  assert.equal(got.confidence, "HIGH");
  assert.equal(got.extraction_method, "theme_color+css_frequency");
  assert.equal(got.background, "#C8102E");
  assert.equal(got.logo_url, "https://acme.example.com/media/logo.svg");
});

test("a site with no brand data falls back LOW and empty, never to a guess", async () => {
  const html = `<html><head><title>Plain</title></head><body>
    <style>body { color: #111111; background: #ffffff; }
    .box { border: 1px solid #cccccc; padding: #222222; }</style>
    <p>Hello.</p></body></html>`;
  const got = await identity({ html, baseUrl: "https://plain.example.com/" });
  assert.equal(got.accent_color, "");
  assert.equal(got.secondary_color, "");
  assert.equal(got.confidence, "LOW");
  assert.equal(got.extraction_method, "fallback_neutral");
  assert.equal(got.background, "#FFFFFF");

  const nothing = await identity({ html: "", baseUrl: "https://x.example.com/" });
  assert.equal(nothing.confidence, "LOW");
  assert.equal(nothing.accent_color, "");
});

test("logo detection: logo-named beats positional, header beats footer", () => {
  const html = `
    <html><body>
      <footer><img class="footer-logo" src="/img/logo-grey.png" alt="logo"></footer>
      <header>
        <img class="site-logo" src="/img/real-mark.webp" alt="Acme Roofing logo">
        <img src="/img/hero-photo.jpg" alt="a roof">
      </header>
    </body></html>`;
  const candidates = extractor.findLogoCandidates(html, "https://acme.example.com/");
  assert.equal(candidates[0], "https://acme.example.com/img/real-mark.webp");
  assert.equal(extractor.extractLogoUrl(html, "https://acme.example.com/"), "https://acme.example.com/img/real-mark.webp");
});

test("logo detection: alt-text logo, then first header img, then favicon ladder", () => {
  const altLogo = '<img src="/mark.png" alt="Sunset Roofing logo">';
  assert.equal(
    extractor.extractLogoUrl(`<main>${altLogo}</main>`, "https://sunset.example.com/"),
    "https://sunset.example.com/mark.png",
  );

  const headerFirst = `<header><img src="/not-a-logo.jpg" alt="crew photo"><img src="/also-not.png" alt="truck"></header>`;
  assert.equal(
    extractor.extractLogoUrl(headerFirst, "https://sunset.example.com/"),
    "https://sunset.example.com/not-a-logo.jpg",
  );

  const favicons = `<head>
    <link rel="icon" href="/tiny.ico">
    <link rel="apple-touch-icon" href="/touch.png">
  </head>`;
  assert.equal(
    extractor.extractLogoUrl(favicons, "https://sunset.example.com/"),
    "https://sunset.example.com/touch.png",
    "apple-touch-icon outranks icon",
  );

  const iconOnly = '<link rel="shortcut icon" href="/f.ico">';
  assert.equal(
    extractor.extractLogoUrl(iconOnly, "https://sunset.example.com/"),
    "https://sunset.example.com/f.ico",
  );

  assert.equal(extractor.extractLogoUrl("<p>nothing</p>", "https://sunset.example.com/"), "");
});

test("logo detection: tracking pixels, data URIs and non-https sources are refused", () => {
  const html = `<header>
    <img src="data:image/png;base64,AAAA" class="logo" alt="logo">
    <img src="http://insecure.example.com/logo.png" class="logo" alt="logo">
    <img width="1" height="1" src="https://pixel.example.com/logo.gif" class="logo" alt="logo">
  </header>`;
  assert.equal(extractor.extractLogoUrl(html, "https://acme.example.com/"), "");
});

test("WordPress stylesheets: linked wp-content CSS is fetched, counted and heard", async () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/wp-content/themes/bricks Child/style.css">
    <link rel="stylesheet" href="/wp-content/uploads/other.css">
    <link rel="stylesheet" href="/not-fetched-because-limit.css">
  </head><body><p>plain</p></body></html>`;
  const fetched = [];
  const got = await identity({
    html,
    baseUrl: "https://wp.example.com/",
    cssLimit: 2,
    fetchCss: async (href) => {
      fetched.push(href);
      // The theme stylesheet: the brand lives here, not in the document.
      return href.includes("style.css")
        ? ".btn{background:#0c449a}.link{color:#0c449a}.x{color:#0C449A}.y{color:#ffffff}"
        : ".z{color:#111111}";
    },
  });
  assert.equal(fetched.length, 2, "cssLimit caps the fetches");
  assert.ok(fetched[0].includes("/wp-content/themes/bricks%20Child/style.css") || fetched[0].includes("style.css"), fetched[0]);
  assert.equal(got.css_fetches, 2);
  assert.equal(got.accent_color, "#0C449A");
  assert.equal(got.confidence, "MEDIUM");
});

test("rgb()/hsl() spellings are counted alongside hex", async () => {
  const html = `<style>
    .a{color:rgb(12, 68, 154)}
    .b{background:rgba(12, 68, 154, 0.15)}
    .c{color:hsl(213, 86%, 33%)}
    .d{color:#333333}
  </style>`;
  const got = await identity({ html, baseUrl: "https://rgb.example.com/" });
  assert.equal(got.accent_color, "#0C449A");
});

test("confidence: css-only is MEDIUM, theme-color-only is MEDIUM", async () => {
  const cssOnly = await identity({
    html: '<style>.a{color:#7B3F71}</style>',
    baseUrl: "https://a.example.com/",
  });
  assert.equal(cssOnly.confidence, "MEDIUM");
  assert.equal(cssOnly.extraction_method, "css_frequency");
  assert.equal(cssOnly.accent_color, "#7B3F71");

  const themeOnly = await identity({
    html: '<meta name="theme-color" content="#0B5CAB"><style>.a{color:#333333}</style>',
    baseUrl: "https://b.example.com/",
  });
  assert.equal(themeOnly.confidence, "MEDIUM");
  assert.equal(themeOnly.extraction_method, "theme_color");
  assert.equal(themeOnly.accent_color, "#0B5CAB");
});

test("fonts: Google Fonts link wins; icon fonts and generics are never the brand", async () => {
  const html = `<link rel="preconnect" href="https://fonts.gstatic.com">
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600&display=swap" rel="stylesheet">`;
  const css = `body{font-family:"Inter",sans-serif}
    .dashicons{font-family:dashicons}
    .fa{font-family:"Font Awesome 6 Free"}
    h1{font-family:Inter,sans-serif}
    p{font-family:inherit}`;
  const got = await identity({ html, baseUrl: "https://fonts.example.com/", cssTexts: [css] });
  assert.equal(got.font_family, "Fredoka");

  const cssOnly = await identity({
    html: "<p>no font links</p>",
    baseUrl: "https://fonts.example.com/",
    cssTexts: [css],
  });
  assert.equal(cssOnly.font_family, "Inter", "most frequent non-generic, non-icon family");
});

test("theme.buildPalette: an applied identity wears the CLIENT's red, not the donor's", () => {
  // The failure, at the palette layer: fencing-sterling's vertical fallback for
  // this trade is Architectural Charcoal #404A57. An applied brandIdentity —
  // normalizeBrandIdentity's verdict, LOW never applied — overrides the donor
  // default at the front door.
  const applied = { applied: true, accent: "#E31E24", secondary: "#0F172B", background: "#FFFFFF" };
  const fromIdentity = theme.buildPalette({ vertical: "fencing", brandIdentity: applied });
  assert.equal(fromIdentity.accent, "#E31E24");
  assert.equal(fromIdentity.source, "brand_identity_extraction");
  assert.equal(fromIdentity.fallbackName, undefined, "no fallback was used, so none is claimed");
  assert.equal(fromIdentity.tintHue, theme.hexToHsl("#0F172B").h, "secondary drives the surface tint");

  // Not applied (LOW refused, absent, unusable accent): the donor default stands.
  for (const refused of [null, { applied: false }, { applied: false, accent: "#E31E24" }]) {
    const p = theme.buildPalette({ vertical: "fencing", brandIdentity: refused });
    assert.equal(p.source, "vertical_research_fallback", JSON.stringify(refused));
    assert.equal(p.accent, "#404A57");
  }

  // The logo-sampled path keeps its own saturation floor: an identity accent is
  // trusted at face value (the extractor asserted it), a logo-sampled grey is not.
  const logoGrey = theme.buildPalette({ vertical: "fencing", accent: "#CCCCCC" });
  assert.equal(logoGrey.source, "vertical_research_fallback");
});

test("schema: a miner-shaped brand_identity validates; junk is rejected", () => {
  const base = {
    slug: "hurricane-fence-services-suffolk",
    facts: { business_name: "Hurricane Fence Inc", industry: "fencing", city: "Suffolk", state: "VA" },
  };

  const ok = checkMirrorRequest({
    ...base,
    brand_identity: {
      accent_color: "#E31E24",
      secondary_color: "#0F172B",
      background: "#FFFFFF",
      logo_url: "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp",
      font_family: "Fredoka",
      extraction_method: "css_frequency",
      confidence: "MEDIUM",
    },
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.body || {}));

  // Absent stays fine — the field is optional in both directions.
  assert.equal(checkMirrorRequest(base).ok, true);

  // LOW is schema-legal on purpose: the engine accepts it and refuses it at
  // render, documenting the refusal instead of masking a transport error.
  assert.equal(checkMirrorRequest({
    ...base,
    brand_identity: { accent_color: "#E31E24", extraction_method: "fallback_neutral", confidence: "LOW" },
  }).ok, true);

  const badHex = checkMirrorRequest({ ...base, brand_identity: { accent_color: "#038", extraction_method: "x", confidence: "LOW" } });
  assert.equal(badHex.ok, false, "the entity artefact must not be schema-legal");

  const missingAccent = checkMirrorRequest({ ...base, brand_identity: { extraction_method: "x", confidence: "LOW" } });
  assert.equal(missingAccent.ok, false, "accent_color is schema-required");

  const badUri = checkMirrorRequest({ ...base, brand_identity: { accent_color: "#E31E24", extraction_method: "x", confidence: "LOW", logo_url: "http://insecure/x.png" } });
  assert.equal(badUri.ok, false, "logo_url is https-only");

  const badConfidence = checkMirrorRequest({ ...base, brand_identity: { accent_color: "#E31E24", extraction_method: "x", confidence: "SORTA" } });
  assert.equal(badConfidence.ok, false);

  const longFont = checkMirrorRequest({ ...base, brand_identity: { accent_color: "#E31E24", extraction_method: "x", confidence: "LOW", font_family: "F".repeat(61) } });
  assert.equal(longFont.ok, false, "font_family caps at 60");

  const unknownField = checkMirrorRequest({ ...base, brand_identity: { vibes: "immaculate" } });
  assert.equal(unknownField.ok, false, "additionalProperties stays closed");
});

test("miner.brandIdentityForRequest maps to the schema shape and drops junk field-by-field", () => {
  const got = miner.brandIdentityForRequest({
    accent_color: "#e31e24",
    secondary_color: "#0f172b",
    background: "#ffffff",
    logo_url: "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp",
    font_family: "  Fredoka  ",
    extraction_method: "css_frequency",
    confidence: "medium",
    extracted_from: "https://www.hurricanefenceinc.com/",
    css_fetches: 3,
    signals: { accent_count: 8 },
  });
  assert.deepEqual(got, {
    accent_color: "#E31E24",
    secondary_color: "#0F172B",
    background: "#FFFFFF",
    logo_url: "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp",
    font_family: "Fredoka",
    extraction_method: "css_frequency",
    confidence: "MEDIUM",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(got, "css_fetches"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(got, "signals"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(got, "extracted_from"), false,
    "extracted_from is record evidence, not schema-carried");

  // The schema requires the accent/extraction_method/confidence trio: without
  // a usable accent the mapping is empty and the caller omits the field.
  assert.deepEqual(miner.brandIdentityForRequest({
    extraction_method: "fallback_neutral", confidence: "LOW",
  }), {});

  // Without the required trio (confidence dropped as malformed) the mapping is
  // empty — a schema-invalid object must never be sent at all.
  assert.deepEqual(miner.brandIdentityForRequest({
    accent_color: "#e31e24",
    logo_url: "http://insecure/x.png",
    confidence: "SORTA",
    extraction_method: "css_frequency",
  }), {});

  // Malformed optional fields drop individually; the trio survives.
  const partial = miner.brandIdentityForRequest({
    accent_color: "#e31e24",
    secondary_color: "#038",
    logo_url: "http://insecure/x.png",
    confidence: "medium",
    extraction_method: "css_frequency",
  });
  assert.deepEqual(partial, { accent_color: "#E31E24", confidence: "MEDIUM", extraction_method: "css_frequency" });

  assert.deepEqual(miner.brandIdentityForRequest(null), {});
});

test("the fixture identity flows the engine's normalizeBrandIdentity gate and paints", async () => {
  const got = await identity({ html: FIXTURE, baseUrl: FIXTURE_URL });
  const normalized = theme.normalizeBrandIdentity(miner.brandIdentityForRequest(got));

  // MEDIUM confidence: applied. The engine will override the fencing-sterling
  // donor's gold with Hurricane Fence's red.
  assert.equal(normalized.applied, true, JSON.stringify(normalized));
  assert.equal(normalized.accent, "#E31E24");
  assert.equal(normalized.secondary, "#0F172B");
  assert.equal(normalized.background, "#FFFFFF");
  assert.equal(normalized.logoUrl, "https://www.hurricanefenceinc.com/wp-content/uploads/2026/05/screenshot.webp");
  assert.equal(normalized.confidence, "MEDIUM");

  const palette = theme.buildPalette({ vertical: "fencing", brandIdentity: normalized });
  assert.equal(palette.accent, "#E31E24", "the client's red, not the donor's charcoal/gold");
  assert.equal(palette.source, "brand_identity_extraction");
  assert.equal(palette.tintHue, theme.hexToHsl("#0F172B").h, "secondary drives the surface tint");

  // The no-brand-data identity maps to nothing, which normalizes to refused.
  const empty = await identity({
    html: "<style>body{color:#111111;background:#ffffff}</style>",
    baseUrl: "https://plain.example.com/",
  });
  const refused = theme.normalizeBrandIdentity(miner.brandIdentityForRequest(empty));
  assert.equal(refused.applied, false, JSON.stringify(refused));
});

test("miner brand extraction is default-on and kill-switchable", () => {
  assert.equal(miner.brandExtractionEnabled({}), true);
  assert.equal(miner.brandExtractionEnabled({ GHOST_AGENCY_BRAND_EXTRACTION: "0" }), false);
  assert.equal(miner.brandExtractionEnabled({ GHOST_AGENCY_BRAND_EXTRACTION: "true" }), true);
});
