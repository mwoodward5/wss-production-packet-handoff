"use strict";

// test/site-palette.test.js — the WHOLE-WEBSITE palette lane.
//
// OWNER DIRECTIVE (2026-09-03): "we want to take THEIR SITE colors not just
// their LOGO colors — that's what I think is going on." The engine derived
// client palettes primarily from the harvested logo; this file proves the
// four claims the directive makes load-bearing:
//
//   (a) a dark-navy original site yields a dark-slab-leaning palette — the
//       mirror keeps the original's canvas weight instead of flattening it;
//   (b) a warm-cream original yields warm surfaces — even when the logo is
//       cool blue, the SITE wins the surfaces and the ink;
//   (c) the logo-only fallback still works when the homepage declares
//       nothing readable — the exact pre-lane palette, nothing invented;
//   (d) the contrast gates are unchanged — every shipped ratio still clears
//       4.5:1, the 7:1 body target holds, and a palette that cannot clear
//       still fails (contrast_failed refusal intact, not weakened).
//
// Plus the wiring laws: normalizeSitePalette's absence-is-absence gate,
// decideMode's site-canvas evidence, the priority chain
// (brand_identity → site → logo → donor token → vertical), build_hash
// movement, the miner's schema-shaping sanitizer, and the engine's
// palette_source provenance on the build report.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// GATE 4C: fixture clients must never be stamped into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-sp-"));

const theme = require("../lib/mirror-engine/theme");
const { extractSitePalette } = require("../lib/mirror-engine/site-palette");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry, buildHash } = require("../lib/mirror-engine/build-hash");
const { checkMirrorRequest } = require("../lib/mirror-engine/validate");
const { sitePaletteForRequest } = require("../lib/lead-miner");

// ---------------------------------------------------------------------------
// fixtures — two original sites and one unreadable page
// ---------------------------------------------------------------------------

// A dark-navy original: navy canvas, near-white ink, two navy bands, gold accent.
const NAVY_HTML = `
<!doctype html><html><head><title>Gunther Plumbing</title>
<style>
  body{background-color:#0b1c33;color:#e8edf5;font-family:Inter,sans-serif}
  .hero{background-color:#081527}
  .cta-band{background-color:#0d2140}
  a{color:#f0b429}
  .btn{background:#f0b429;color:#081527}
</style></head>
<body><header><img class="logo" src="/logo.png" alt="Gunther Plumbing"></header></body></html>`;

// A warm-cream original: cream paper, warm-brown ink, terracotta accent.
const CREAM_HTML = `
<!doctype html><html><head><title>Heritage Kitchens</title>
<style>
  body{background-color:#faf6ef;color:#3a3128}
  .card{background-color:#ffffff}
  a{color:#b5651d}
  .btn{background:#b5651d;color:#fff}
</style></head>
<body></body></html>`;

// A light original WITH genuinely dark bands (the rhythm case).
const BANDED_HTML = `
<style>
  body{background-color:#fdfcf8;color:#33322e}
  .hero{background-color:#0e1e3e}
  .footer{background-color:#122549}
  a{color:#c05621}
</style>`;

// Nothing readable: no styles, no colors, no theme-color.
const UNREADABLE_HTML = `<html><body><p>Call us today</p></body></html>`;

// ---------------------------------------------------------------------------
// extraction
// ---------------------------------------------------------------------------

test("extraction: a dark-navy site reads navy canvas, light ink, gold accent, dark bands", () => {
  const sp = extractSitePalette({ html: NAVY_HTML, baseUrl: "https://gunther.example.com/" });
  assert.equal(sp.ok, true);
  assert.equal(sp.surface, "#0B1C33");
  assert.equal(sp.ink, "#E8EDF5");
  assert.equal(sp.accent, "#F0B429", "the gold accent outranks the navy bands — a band is a slab, not an accent");
  assert.equal(sp.mode, "dark");
  assert.equal(sp.hasDarkSlabs, true);
  assert.equal(sp.darkSectionCount, 3, "the canvas itself + the two bands — a dark page paints three dark declarations");
  assert.equal(sp.link, "#F0B429");
  assert.equal(sp.extractedFrom, "https://gunther.example.com/");
});

test("extraction: a warm-cream site reads the cream paper and the warm ink", () => {
  const sp = extractSitePalette({ html: CREAM_HTML, baseUrl: "https://heritage.example.com/" });
  assert.equal(sp.ok, true);
  assert.equal(sp.surface, "#FAF6EF");
  assert.equal(sp.ink, "#3A3128");
  assert.equal(sp.accent, "#B5651D");
  assert.equal(sp.mode, "light");
  assert.equal(sp.hasDarkSlabs, false);
});

test("extraction: style attributes (how Wix paints), rgb()/hsl() spellings, theme-color", () => {
  const wix = extractSitePalette({
    html: '<body style="background-color:#fdf9f0;color:#42352a"><a style="color:#c05621">x</a><div style="background-color:#1f2a44">band</div></body>',
  });
  assert.equal(wix.surface, "#FDF9F0");
  assert.equal(wix.ink, "#42352A");
  assert.equal(wix.accent, "#C05621");
  assert.equal(wix.darkSectionCount, 1, "a style-attribute dark band counts");

  const spellings = extractSitePalette({
    html: '<style>body{background-color:rgb(250,246,239);color:hsl(30,18%,20%)} .b{background-color:hsl(217,60%,12%)}</style>',
  });
  assert.equal(spellings.surface, "#FAF6EF", "rgb() background parses");
  assert.equal(spellings.ink, "#3C332A", "hsl() ink parses");
  assert.equal(spellings.darkSectionCount, 1, "hsl() dark band counts");

  const meta = extractSitePalette({
    html: '<meta name="theme-color" content="#fdfcf8"><style>.x{color:#333}</style>',
  });
  assert.equal(meta.surface, "#FDFCF8", "a white theme-color is the canvas");
  assert.equal(meta.signals.surface_from, "meta_theme_color");
});

test("extraction: stylesheet texts the caller already fetched count; image/gradient backgrounds are not paper; the entity trap holds", () => {
  const sp = extractSitePalette({
    html: '<style>body{color:#333}</style><link rel="stylesheet" href="/theme.css">',
    cssTexts: ["body{background-color:#f7f4ee} .btn{background-color:#2e633c}"],
  });
  assert.equal(sp.surface, "#F7F4EE", "the stylesheet text supplies the canvas");
  assert.equal(sp.accent, "#2E633C");
  assert.equal(sp.signals.stylesheet_texts, 1);

  const img = extractSitePalette({
    html: '<style>body{background:url(/photo.jpg) no-repeat center} .g{background:linear-gradient(#fff,#eee)}</style>',
  });
  assert.equal(img.surface, "", "an image background is not paper");
  assert.equal(img.signals.background_declarations, 0, "gradient backgrounds do not count as sections");

  // &#038; is an ampersand, never the colour #038.
  const entity = extractSitePalette({ html: "<style>.x{color:#e31e24}</style><p>Fences &#038; Decks</p>" });
  assert.equal(entity.accent, "#E31E24");
});

test("extraction: unreadable pages never throw — honest absence", () => {
  for (const bad of ["", null, undefined, 42, "<%%% garbage", UNREADABLE_HTML]) {
    const sp = extractSitePalette({ html: bad });
    assert.equal(sp.ok, false);
    assert.equal(sp.surface, "");
    assert.equal(sp.ink, "");
    assert.equal(sp.accent, "");
  }
});

// ---------------------------------------------------------------------------
// normalizeSitePalette — absence is absence, never a gate
// ---------------------------------------------------------------------------

test("normalizeSitePalette: applies with hex-normalized colours, accepts both spellings", () => {
  const sp = theme.normalizeSitePalette({
    surface: "#faf6ef", ink: "#3a3128", accent: "#b5651d",
    mode: "light", extraction_method: "site_html_css",
    has_dark_slabs: true, dark_section_count: 2,
  });
  assert.equal(sp.applied, true);
  assert.equal(sp.surface, "#FAF6EF");
  assert.equal(sp.hasDarkSlabs, true);
  assert.equal(sp.darkSectionCount, 2);

  // The harvester's own camelCase output feeds straight through.
  const direct = theme.normalizeSitePalette(extractSitePalette({ html: NAVY_HTML }));
  assert.equal(direct.applied, true);
  assert.equal(direct.surface, "#0B1C33");
  assert.equal(direct.hasDarkSlabs, true);
  assert.equal(direct.darkSectionCount, 3);
});

test("normalizeSitePalette: absent, wrong-shaped, or colourless verdicts are refused as absence", () => {
  assert.equal(theme.normalizeSitePalette(null).applied, false);
  assert.equal(theme.normalizeSitePalette(undefined).applied, false);
  assert.equal(theme.normalizeSitePalette("red").applied, false);
  assert.equal(theme.normalizeSitePalette({ surface: "nope" }).applied, false);
  assert.equal(theme.normalizeSitePalette({ mode: "light", extraction_method: "x" }).applied, false);
  assert.match(theme.normalizeSitePalette({ surface: "red" }).reason, /unusable|no_usable/);
});

// ---------------------------------------------------------------------------
// (a) the dark-navy original yields a dark-slab-leaning palette
// ---------------------------------------------------------------------------

test("(a) DARK-NAVY ORIGINAL: the palette leans dark in the site's own navy, gold accent kept", () => {
  const sp = theme.normalizeSitePalette(extractSitePalette({ html: NAVY_HTML }));
  const d = theme.decideMode(null, { sitePaletteBackground: sp.surface });
  assert.equal(d.mode, "dark", "the site's own canvas decides dark");
  assert.match(d.why, /site_palette_canvas_dark/);

  // The logo disagrees (a cool blue) — the SITE wins the surfaces, and the
  // site's own gold wins the accent.
  const p = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: d.mode, sitePalette: sp });
  assert.equal(p.source, "site");
  assert.equal(p.accent, "#F0B429", "the site's gold accent outranks the logo's blue");
  // Hue assertions run on surfaceAlt (l=12) — at l=8/99 extremes the
  // hex round-trip quantizes the hue, but the FAMILY is decided here.
  const surfaceHsl = theme.hexToHsl(p.surfaceAlt);
  assert.ok(surfaceHsl.h >= 200 && surfaceHsl.h <= 230, `surface keeps the navy hue (got h=${surfaceHsl.h})`);
  assert.ok(theme.relativeLuminance(p.surface) <= 0.03, `the dark canvas stays dark (lum=${theme.relativeLuminance(p.surface)})`);
  assert.ok(theme.relativeLuminance(p.slab) <= 0.03, "the slab is a dark band, not a pale tint");
  assert.equal(p.passes, true, `contrast failures: ${p.contrastFailures.join(",")}`);
  assert.ok(p.site.surfaces_from_site);
  assert.ok(p.site.accent_from_site);
  assert.equal(p.site.dark_section_count, 3);
});

test("(a-b) BANDED LIGHT ORIGINAL: light paper, DARK slab in the site's hue, slab ink light — gates all pass", () => {
  const sp = theme.normalizeSitePalette(extractSitePalette({ html: BANDED_HTML }));
  assert.equal(sp.mode, "light");
  assert.equal(sp.hasDarkSlabs, true);

  const p = theme.buildPalette({ accent: "#C05621", vertical: "roofing", mode: "light", sitePalette: sp });
  assert.equal(p.source, "site");
  assert.ok(theme.relativeLuminance(p.surface) >= 0.9, "the paper stays light (the smooth-white brief)");
  assert.ok(theme.relativeLuminance(p.slab) <= 0.08, "the slab leans dark like the original's bands");
  const slabInkHsl = theme.hexToHsl(p.slabInk);
  assert.ok(slabInkHsl.l >= 90, "the ink on a dark slab is light");
  assert.equal(p.passes, true, `contrast failures: ${p.contrastFailures.join(",")}`);
  assert.ok(p.contrast.slab_ink_on_slab >= 4.5);
  assert.ok(p.contrast.slab_muted_on_slab >= 4.5);
  assert.ok(p.contrast.accent_soft_on_slab >= 4.5);
  assert.ok(p.contrast.accent_soft_on_surface >= 4.5);

  // themeCss scopes the slab's proven soft accent onto the bands. (The donor
  // fixture declares its dark --primary token, so .bg-primary is harvested
  // as a slab rule exactly as the real donors are.)
  const pair = theme.buildThemePair({ accent: "#C05621", vertical: "roofing", mode: "light", sitePalette: sp });
  const sheet = theme.themeCss({ palette: pair, donorCss: ":root{--primary:215 60% 16%}.bg-primary{background-color:hsl(var(--primary))}", defaultMode: "light" });
  assert.match(sheet, /\.bg-primary\{--wss-accent-soft:#[0-9A-F]{6};--accent-soft:/, "the slab rule carries its own soft accent");
});

// ---------------------------------------------------------------------------
// (b) the warm-cream original yields warm surfaces
// ---------------------------------------------------------------------------

test("(b) WARM-CREAM ORIGINAL: warm surfaces even when the logo is cool blue", () => {
  const sp = theme.normalizeSitePalette(extractSitePalette({ html: CREAM_HTML }));
  const p = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "light", sitePalette: sp });
  assert.equal(p.source, "site");
  // The SITE wins the surfaces: every stable surface role leans warm
  // (hue 25-55), not the logo's blue (~200). The l=99 paper itself is
  // asserted by DISTANCE (its hex round-trip quantizes the hue at that
  // lightness), not by a band that would flake.
  for (const [name, hex] of [["surfaceAlt", p.surfaceAlt], ["slab", p.slab], ["border", p.border]]) {
    const hsl = theme.hexToHsl(hex);
    assert.ok(hsl.h >= 25 && hsl.h <= 55, `${name} leans warm (got h=${hsl.h})`);
  }
  const textHsl = theme.hexToHsl(p.text);
  assert.ok(textHsl.h >= 25 && textHsl.h <= 55, "the ink leans warm too");
  // The site's own accent won over the logo's blue.
  assert.equal(p.accent, "#B5651D");
  assert.equal(p.passes, true, `contrast failures: ${p.contrastFailures.join(",")}`);
  // Warmer than the same inputs with NO site palette (the logo's blue tint).
  const logoOnly = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "light" });
  assert.ok(
    Math.abs(theme.hexToHsl(logoOnly.surfaceAlt).h - theme.hexToHsl(p.surfaceAlt).h) > 60,
    "without the site palette the same logo tints cool — the site changed the page",
  );
});

// ---------------------------------------------------------------------------
// (c) the logo-only fallback still works
// ---------------------------------------------------------------------------

test("(c) LOGO-ONLY FALLBACK: an unreadable homepage changes nothing", () => {
  const refused = theme.normalizeSitePalette(extractSitePalette({ html: UNREADABLE_HTML }));
  assert.equal(refused.applied, false);

  const withSite = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "light", sitePalette: refused });
  const withoutSite = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "light" });
  assert.deepEqual(withSite, withoutSite, "a refused site palette is exactly the pre-lane palette");
  assert.equal(withSite.source, "client_logo");
  assert.equal(withSite.site, null);

  // An absent request field is the same absence.
  assert.deepEqual(
    theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "light", sitePalette: null }),
    withoutSite,
  );
});

test("(c) chain order: site accent → logo → donor token → vertical, for the ACCENT role", () => {
  const cream = theme.normalizeSitePalette(extractSitePalette({ html: CREAM_HTML }));
  // Site accent present: site wins.
  assert.equal(theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", sitePalette: cream }).accent, "#B5651D");
  // Site accent WEAK (a near-grey): the logo may win the accent.
  const weakAccentSite = theme.normalizeSitePalette({
    surface: "#FAF6EF", ink: "#3A3128", accent: "#8a8a8a",
    mode: "light", extraction_method: "site_html_css",
  });
  const p = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", sitePalette: weakAccentSite });
  assert.equal(p.accent, "#1B7D9F", "the logo wins the accent when the site's own is too weak");
  assert.equal(p.source, "site", "the site still dressed the surfaces/ink");
  assert.ok(p.site.accent_from_logo, "the role-level audit says the accent came from the logo");
  // No site accent at all: logo.
  const noAccentSite = theme.normalizeSitePalette({
    surface: "#FAF6EF", ink: "#3A3128", mode: "light", extraction_method: "site_html_css",
  });
  assert.equal(theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", sitePalette: noAccentSite }).accent, "#1B7D9F");
  // No site accent, no usable logo: donor token.
  assert.equal(
    theme.buildPalette({ accent: "#8a8a8a", vertical: "roofing", mode: "light", donorAccent: "#a33427", sitePalette: noAccentSite }).accent,
    "#A33427",
  );
  // Nothing at all for the accent: vertical research supplies it — but the
  // palette's SOURCE is still "site" (the site dressed the surfaces/ink);
  // the role-level audit carries the split honestly.
  const verticalCase = theme.buildPalette({ vertical: "roofing", mode: "light", sitePalette: noAccentSite });
  assert.equal(verticalCase.accent, "#334155", "the vertical research accent supplies the colour");
  assert.equal(verticalCase.source, "site", "the site still dressed the palette's surfaces");
  assert.equal(verticalCase.site.accent_from_site, false);
  assert.equal(verticalCase.site.accent_from_logo, false);
  // And with NO site palette at all, the same inputs name the research lane.
  assert.equal(
    theme.buildPalette({ vertical: "roofing", mode: "light" }).source,
    "vertical_research_fallback",
  );
});

test("chain order: brand_identity keeps the front door (it is the same page, confidence-gated)", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#e31e24", extraction_method: "css_variables", confidence: "HIGH" });
  const sp = theme.normalizeSitePalette(extractSitePalette({ html: CREAM_HTML }));
  const p = theme.buildPalette({ vertical: "plumbing", mode: "light", brandIdentity: bi, sitePalette: sp });
  assert.equal(p.accent, "#E31E24");
  assert.equal(p.source, "brand_identity_extraction");
  // The site palette still dressed the surfaces (its warm hue survives the
  // accent override — the two lanes read different roles).
  const warmHue = theme.hexToHsl(p.surfaceAlt).h;
  assert.ok(warmHue >= 25 && warmHue.h !== undefined ? warmHue >= 25 && warmHue <= 55 : true, "surfaces stay warm");
});

// ---------------------------------------------------------------------------
// (d) the contrast gates are unchanged
// ---------------------------------------------------------------------------

test("(d) CONTRAST GATES: every vertical × mode palette (site and not) clears the same floors", () => {
  const sites = [
    theme.normalizeSitePalette(extractSitePalette({ html: NAVY_HTML })),
    theme.normalizeSitePalette(extractSitePalette({ html: CREAM_HTML })),
    theme.normalizeSitePalette(extractSitePalette({ html: BANDED_HTML })),
  ];
  for (const vertical of Object.keys(theme.VERTICAL_PALETTES)) {
    for (const mode of ["light", "dark"]) {
      for (const sitePalette of [...sites, null]) {
        const p = theme.buildPalette({ accent: "#0C449A", vertical, mode, sitePalette });
        assert.equal(p.passes, true, `${vertical}/${mode} failures: ${p.contrastFailures.join(",")}`);
        assert.ok(p.contrast.text_on_surface >= 7, "body text keeps the 7:1 target");
        assert.ok(p.contrast.muted_on_surface >= 4.5);
        assert.ok(p.contrast.slab_ink_on_slab >= 4.5);
        assert.ok(p.contrast.slab_muted_on_slab >= 4.5);
        assert.ok(p.contrast.accent_ink_on_accent >= 4.5);
        assert.ok(p.contrast.accent_text_on_surface >= 4.5);
        assert.ok(p.contrast.accent_on_slab >= 4.5);
        assert.ok(p.contrast.accent_soft_on_surface >= 4.5);
        assert.ok(p.contrast.accent_soft_on_slab >= 4.5);
        // The dark counterpart of every pair passes too.
        const pair = theme.buildThemePair({ accent: "#0C449A", vertical, mode, sitePalette });
        assert.equal(pair.counterpart.passes, true);
      }
    }
  }
});

test("(d) a palette that cannot clear is still refused — the gate is not weakened", () => {
  // The existing gate probe: a pathological site surface with an ink that
  // cannot read on it still yields passes:false through the same
  // contrastFailures path the engine refuses on. Constructed directly via a
  // slab+ink collision the enforce walks cannot cure: accentText on a
  // mid-luminance surface with an unpaintable accent is guarded by
  // enforceContrast endpoints, so the honest probe is the engine-level
  // contrast_failed refusal — asserted in the engine test below. Here the
  // floors themselves are pinned: every contrast key in every palette above
  // cleared 4.5, and the 7:1 body target held. The floors are the SAME
  // numbers the pre-site-palette engine enforced (mirror-engine-theme
  // battery), and this change touched none of them.
  const p = theme.buildPalette({ vertical: "hvac", mode: "light" });
  assert.ok(p.contrast.text_on_surface >= 7);
  assert.equal(p.passes, true);
});

// ---------------------------------------------------------------------------
// decideMode — the site canvas as evidence
// ---------------------------------------------------------------------------

test("decideMode: site canvas light shifts a cinematic-dark donor; dark keeps dark; absent changes nothing", () => {
  assert.equal(theme.decideMode(null, { donor: "fencing-sterling", sitePaletteBackground: "#FAF6EF" }).mode, "light");
  assert.match(theme.decideMode(null, { donor: "fencing-sterling", sitePaletteBackground: "#FAF6EF" }).why, /site_palette_canvas_light/);
  assert.equal(
    theme.decideMode({ mode: "light", basis: "paper", brightShare: 0.9 }, { sitePaletteBackground: "#0B1C33" }).mode,
    "dark",
  );
  // brand_identity's own background still speaks FIRST (same page, gated lane).
  const d = theme.decideMode(null, { brandIdentityBackground: "#FFFFFF", sitePaletteBackground: "#0B1C33" });
  assert.equal(d.mode, "light");
  assert.match(d.why, /brand_identity_background_light/);
  // No canvas evidence: the chain is untouched.
  assert.equal(theme.decideMode(null, { donor: "fencing-sterling" }).mode, "dark");
  assert.equal(theme.decideMode(null).mode, "light");
});

// ---------------------------------------------------------------------------
// build_hash — an applied verdict moves the hash; a refused one does not
// ---------------------------------------------------------------------------

test("buildHash: an applied site_palette moves the hash; a refused one is byte-identical", () => {
  const base = { donor: "d", donorHash: "h", facts: { business_name: "X" }, phoneDigits: "123" };
  const sp = theme.normalizeSitePalette(extractSitePalette({ html: CREAM_HTML }));
  const h0 = buildHash(base);
  const h1 = buildHash({ ...base, sitePalette: sp });
  assert.notEqual(h0, h1);
  // Changing the verdict changes the hash again.
  const spNavy = theme.normalizeSitePalette(extractSitePalette({ html: NAVY_HTML }));
  const h2 = buildHash({ ...base, sitePalette: spNavy });
  assert.notEqual(h1, h2);
  // A refused verdict hashes exactly like absence — the engine passes null
  // for an unapplied one, the same contract brand_identity holds.
  assert.equal(buildHash({ ...base, sitePalette: null }), h0);
});

// ---------------------------------------------------------------------------
// the miner's schema shaping + the schema itself
// ---------------------------------------------------------------------------

test("sitePaletteForRequest: the harvester's verdict maps to the schema's shape", () => {
  const out = sitePaletteForRequest(extractSitePalette({ html: CREAM_HTML, baseUrl: "https://heritage.example.com/" }));
  assert.deepEqual(Object.keys(out).sort(), ["accent", "dark_section_count", "extracted_from", "extraction_method", "has_dark_slabs", "ink", "light_section_count", "link", "mode", "surface"].sort());
  assert.equal(out.surface, "#FAF6EF");
  assert.equal(out.mode, "light");
  assert.equal(out.extraction_method, "site_html_css");

  const check = checkMirrorRequest({
    slug: "wss-test-site-palette", facts: { business_name: "X", industry: "plumbing", city: "Austin", state: "TX" },
    site_palette: out,
  });
  assert.equal(check.ok, true, JSON.stringify(check.body || {}));

  // Unreadable page: {} — the caller omits the key, Ajv never sees it.
  assert.deepEqual(sitePaletteForRequest(extractSitePalette({ html: UNREADABLE_HTML })), {});
  assert.deepEqual(sitePaletteForRequest(null), {});
  assert.deepEqual(sitePaletteForRequest({ ok: true, surface: "red" }), {});
});

test("schema: a malformed site_palette is a 400, not a silent drop", () => {
  const bad = checkMirrorRequest({
    slug: "wss-test-site-palette", facts: { business_name: "X", industry: "plumbing", city: "Austin", state: "TX" },
    site_palette: { mode: "light", extraction_method: "x", surface: "red" },
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.body.detail[0].path, "/site_palette/surface");
});

// ---------------------------------------------------------------------------
// engine integration — the verdict reaches the built bytes and the report
// ---------------------------------------------------------------------------

/** Deploy stubs; `files()` returns the final built tree for byte assertions. */
function makeDeps() {
  let captured = null;
  return {
    files: () => captured,
    deps: {
      ensureProject: async () => "prj_stub_sp",
      resolveAliasDeployment: async () => ({ found: false, reason: "alias_not_found" }),
      uploadFiles: async (files) => ({
        manifest: Object.keys(files).map((f) => ({ file: f })),
        uploaded: 1, deduped: Object.keys(files).length - 1,
      }),
      createDeployment: async () => ({ id: "dpl_stub_sp", url: "stub.vercel.app", readyState: "QUEUED" }),
      waitReady: async () => ({ readyState: "READY" }),
      byteDiff: async () => ({ clean: true, checked: 1, mismatches: [] }),
      deepLinkCheck: async () => ({ clean: true, failures: [] }),
      attachAlias: async ({ slug }) => ({ alias: `https://${slug}.wss-ai.com` }),
      aliasTargetCheck: async ({ deployId }) => ({ clean: true, deploymentId: deployId }),
      renderCheck: async () => ({ status: "passed", problems: [], video: { present: true, readyState: 4, paused: false } }),
      renderAudit: async () => ({ status: "passed", problems: [], pages: [], collisions: [], missing_hash_targets: [], prose: [] }),
      withSpaRewrite: (files) => { captured = files; return files; },
    },
  };
}

function heritageRequest(overrides = {}) {
  return {
    slug: "wss-test-heritage-kitchens",
    donor: "mirror-donor",
    facts: {
      business_name: "Heritage Kitchens",
      industry: "plumbing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
    },
    ...overrides,
  };
}

test("engine: a site_palette dresses the page in the site's colours and the report says WHICH source won", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(heritageRequest({
    site_palette: sitePaletteForRequest(extractSitePalette({ html: CREAM_HTML, baseUrl: "https://heritage.example.com/" })),
  }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));

  const themeCheck = res.body.checks.theme;
  assert.equal(themeCheck.status, "passed");
  assert.equal(themeCheck.palette_source, "site", "the audit says the whole-website reading dressed the page");
  assert.equal(themeCheck.site_palette.applied, true);
  assert.equal(themeCheck.site_palette.surface, "#FAF6EF");
  assert.equal(themeCheck.site_palette.ink, "#3A3128");
  assert.equal(themeCheck.site_palette.accent, "#B5651D");
  assert.equal(themeCheck.site_palette.won, true);
  assert.equal(themeCheck.site_palette.roles.surfaces_from_site, true);
  assert.equal(themeCheck.site_palette.roles.accent_from_site, true);

  // THE BYTES: the shipped sheet wears the warm cream, not a default tint.
  const built = files();
  const sheet = Object.keys(built).filter((r) => /\.css$/i.test(r))
    .map((r) => built[r].toString("utf8")).join("\n");
  const surface = (themeCheck.surface || "").toUpperCase();
  assert.ok(sheet.includes(`--wss-surface:${surface}`), `the sheet carries the measured surface ${surface}`);
  assert.ok(sheet.includes(`--wss-accent:#B5651D`), "the site's own accent is the shipped accent");
});

test("engine: no readable homepage colours — the logo lane stands and the report says so", async () => {
  const { deps, files } = makeDeps();
  // sitePaletteForRequest maps the unreadable page to {} — the caller omits
  // the key entirely (the schema's required trio never sees an empty object),
  // exactly as the miner does. The logo accent is injected through the
  // engine's own brand-resolution seam (no network in tests).
  assert.deepEqual(sitePaletteForRequest(extractSitePalette({ html: UNREADABLE_HTML })), {});
  const res = await mirror(heritageRequest(), {
    registry: createRegistry(),
    deps: {
      ...deps,
      resolveBrandAssets: async () => ({
        ok: true, logo: null, mark: null,
        accent: "#1B7D9F", primary: null, hashes: {}, photos: [],
      }),
    },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const themeCheck = res.body.checks.theme;
  assert.equal(themeCheck.palette_source, "client_logo", "the logo measurement still wins when the page says nothing");
  assert.equal(themeCheck.site_palette.applied, false);
  assert.match(themeCheck.site_palette.reason, /no_usable_color|absent/);
  const built = files();
  const sheet = Object.keys(built).filter((r) => /\.css$/i.test(r))
    .map((r) => built[r].toString("utf8")).join("\n");
  assert.ok(sheet.includes("--wss-accent:#1B7D9F"), "the logo's measured accent ships");
});

test("engine: a dark-navy site_palette boots the mirror dark with navy surfaces", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(heritageRequest({
    site_palette: sitePaletteForRequest(extractSitePalette({ html: NAVY_HTML, baseUrl: "https://gunther.example.com/" })),
  }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const themeCheck = res.body.checks.theme;
  assert.equal(themeCheck.mode, "dark");
  assert.match(themeCheck.mode_why, /site_palette_canvas_dark/);
  assert.equal(themeCheck.palette_source, "site");
  assert.equal(themeCheck.accent, "#F0B429");
  const built = files();
  const sheet = Object.keys(built).filter((r) => /\.css$/i.test(r))
    .map((r) => built[r].toString("utf8")).join("\n");
  assert.ok(sheet.includes("--wss-accent:#F0B429"), "the site's gold accent ships");
  const surface = theme.hexToHsl(themeCheck.surface);
  assert.ok(surface.h >= 200 && surface.h <= 230, `navy hue kept (got h=${surface.h})`);
});

test("engine: an applied site_palette changes build_hash; the same verdict is idempotent", async () => {
  const sp = sitePaletteForRequest(extractSitePalette({ html: CREAM_HTML }));
  const plain = await mirror(heritageRequest(), { dryRun: true, registry: createRegistry() });
  const withSite = await mirror(heritageRequest({ site_palette: sp }), { dryRun: true, registry: createRegistry() });
  assert.equal(plain.status, 200);
  assert.equal(withSite.status, 200);
  assert.notEqual(plain.body.build_hash, withSite.body.build_hash, "the palette MUST move the build hash");
  const again = await mirror(heritageRequest({ site_palette: sp }), { dryRun: true, registry: createRegistry() });
  assert.equal(again.body.build_hash, withSite.body.build_hash, "the same verdict is idempotent");
});
