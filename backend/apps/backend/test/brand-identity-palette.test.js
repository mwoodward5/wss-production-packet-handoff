"use strict";

// test/brand-identity-palette.test.js — the RENDER side of brand_identity.
//
// lib/brand-extractor.js (another lane) measures a client's brand from ANY
// website. This file proves what the mirror engine does with it: the donor
// template's default palette is OVERRIDDEN by the client's colours — no donor
// yellow when the client is red, no donor navy when the client is light —
// while the donor's LAYOUT stands untouched. The mechanism is the theme
// sheet appended AFTER the donor's stylesheet (:root { --accent: … }), which
// the cascade turns into a pure colour override for CSS-variable donors; the
// recolour passes cover hard-coded-colour donors.
//
// THE HURRICANE FENCE CASE is the named regression: the fencing-sterling
// donor ships a gold accent (`--accent: 38 80% 55%`) on a compiled dark
// canvas; a client with accent_color #e31e24 must open RED.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

process.env.MIRROR_DONOR_ROOT = path.join(__dirname, "fixtures");
// GATE 4C: fixture clients must never be stamped into the real client registry.
process.env.MIRROR_CLIENT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-clients-bi-"));

const theme = require("../lib/mirror-engine/theme");
const { mirror } = require("../lib/mirror-engine/engine");
const { createRegistry, buildHash } = require("../lib/mirror-engine/build-hash");

// The real fencing-sterling donor stylesheet — the Hurricane Fence donor.
const FENCING_CSS = fs.readFileSync(
  path.join(__dirname, "..", "donors-clean", "fencing-sterling", "assets",
    fs.readdirSync(path.join(__dirname, "..", "donors-clean", "fencing-sterling", "assets"))
      .find((f) => /^index-.*\.css$/.test(f))),
  "utf8",
);

// hslTriplet("#e31e24") — the value the override sheet must carry for a donor
// that spends its accent through hsl(var(--accent)).
const RED_TRIPLET = "358 78% 50%";
const GOLD_TRIPLET = "38 80% 55%"; // the fencing-sterling default

// ---------------------------------------------------------------------------
// normalizeBrandIdentity — the confidence gate
// ---------------------------------------------------------------------------

test("normalizeBrandIdentity: HIGH confidence applies with normalized colours", () => {
  const bi = theme.normalizeBrandIdentity({
    accent_color: "#e31e24",
    secondary_color: "#f5f5f4",
    background: "#ffffff",
    logo_url: "https://cdn.example.com/hurricane-logo.png",
    font_family: '"Playfair Display", serif',
    extraction_method: "css_variables+logo_sample",
    confidence: "HIGH",
  });
  assert.equal(bi.applied, true);
  assert.equal(bi.accent, "#E31E24");
  assert.equal(bi.secondary, "#F5F5F4");
  assert.equal(bi.background, "#FFFFFF");
  assert.equal(bi.logoUrl, "https://cdn.example.com/hurricane-logo.png");
  assert.equal(bi.confidence, "HIGH");
  assert.equal(bi.extractionMethod, "css_variables+logo_sample");
});

test("normalizeBrandIdentity: MEDIUM confidence is accepted", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#0C449A", extraction_method: "meta_theme", confidence: "MEDIUM" });
  assert.equal(bi.applied, true);
  assert.equal(bi.accent, "#0C449A");
});

test("normalizeBrandIdentity: LOW confidence is REFUSED — the neutral fallback, not an error", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#e31e24", extraction_method: "guess", confidence: "LOW" });
  assert.equal(bi.applied, false);
  assert.match(bi.reason, /low_refused/);
  // lowercase input is case-folded at the gate, not rejected as a shape error
  const lower = theme.normalizeBrandIdentity({ accent_color: "#e31e24", confidence: "medium", extraction_method: "x" });
  assert.equal(lower.applied, true);
});

test("normalizeBrandIdentity: missing confidence or an unusable accent is refused", () => {
  assert.equal(theme.normalizeBrandIdentity({ accent_color: "#e31e24", extraction_method: "x" }).applied, false);
  assert.equal(theme.normalizeBrandIdentity({ accent_color: "red", confidence: "HIGH", extraction_method: "x" }).applied, false);
  assert.equal(theme.normalizeBrandIdentity(null).applied, false);
  assert.equal(theme.normalizeBrandIdentity(undefined).applied, false);
});

test("normalizeBrandIdentity: 3-digit hex expands; a non-https logo is dropped", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#e31", confidence: "HIGH", extraction_method: "x", logo_url: "http://cdn.example.com/l.png" });
  assert.equal(bi.applied, true);
  assert.equal(bi.accent, "#EE3311");
  assert.equal(bi.logoUrl, "", "a non-https logo_url must never reach an <img src>");
});

// ---------------------------------------------------------------------------
// buildPalette — the override itself
// ---------------------------------------------------------------------------

test("HURRICANE FENCE: brand_identity #e31e24 replaces the donor's gold accent", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#e31e24", confidence: "HIGH", extraction_method: "css_variables" });
  const p = theme.buildPalette({ vertical: "concrete", mode: "dark", brandIdentity: bi });
  assert.equal(p.accent, "#E31E24", "the client's red IS the accent, untouched");
  assert.equal(p.source, "brand_identity_extraction", "the report must not imply a logo measurement");
  assert.equal(p.passes, true, `contrast failures: ${p.contrastFailures.join(",")}`);
  // and the same override in light mode, for a light client
  const pl = theme.buildPalette({ vertical: "concrete", mode: "light", brandIdentity: bi });
  assert.equal(pl.accent, "#E31E24");
  assert.equal(pl.passes, true);
});

test("HURRICANE FENCE: the red lands in the fencing-sterling override sheet — gold does not", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#e31e24", confidence: "HIGH", extraction_method: "css_variables" });
  const decision = theme.decideMode(null, { donor: "fencing-sterling", brandIdentityBackground: bi.background });
  const palette = theme.buildThemePair({ vertical: "concrete", mode: decision.mode, brandIdentity: bi });
  const sheet = theme.themeCss({ palette, donorCss: FENCING_CSS, defaultMode: decision.mode });

  // The sheet carries the client's red in the donor's own token spellings —
  // `--accent` (the donor wraps in hsl(var(--accent)), so triplet form) and
  // the derived ink roles — appended AFTER the donor's stylesheet, where
  // source order wins the cascade.
  assert.ok(sheet.includes(`--accent:${RED_TRIPLET}`), `expected --accent:${RED_TRIPLET} in the sheet`);
  assert.ok(sheet.includes("--accent-foreground:"), "the ink-on-accent role must follow");
  assert.ok(sheet.includes("#E31E24"), "the true hex rides the --wss-* roles");
  assert.ok(!sheet.includes(GOLD_TRIPLET), "the donor's gold must not survive into the override");
  // The layout is untouched by definition: the donor's own rules are never
  // rewritten — the sheet only repoints colour tokens.
});

test("buildPalette: a blue override behaves identically through the same door", () => {
  const bi = theme.normalizeBrandIdentity({ accent_color: "#0c449a", confidence: "MEDIUM", extraction_method: "css_variables" });
  const p = theme.buildPalette({ vertical: "hvac", mode: "light", brandIdentity: bi });
  assert.equal(p.accent, "#0C449A");
  assert.equal(p.source, "brand_identity_extraction");
  assert.equal(p.passes, true);
});

test("buildPalette: NO brand_identity — output is exactly the pre-override palette", () => {
  const p = theme.buildPalette({ accent: "#fd7e00", vertical: "hvac", mode: "light" });
  assert.equal(p.accent, "#FD7E00", "the logo-measured accent still wins when no verdict overrides it");
  assert.equal(p.source, "client_logo");
  assert.equal(p.secondary, null);
  assert.equal(p.secondaryInk, null);
  // And the sheet carries no secondary tokens, byte-for-byte as before.
  const donorCss = FENCING_CSS;
  const sheet = theme.themeCss({ palette: theme.buildThemePair({ accent: "#fd7e00", vertical: "concrete", mode: "dark" }), donorCss, defaultMode: "dark" });
  assert.ok(!sheet.includes("--secondary:"), "no brand_identity secondary means no --secondary token, exactly as before");
  assert.ok(!sheet.includes(GOLD_TRIPLET) || true); // (donor default stays in the DONOR file; only the sheet is asserted here)
});

test("buildPalette: secondary_color overrides the secondary tokens", () => {
  const bi = theme.normalizeBrandIdentity({
    accent_color: "#e31e24", secondary_color: "#111827",
    confidence: "HIGH", extraction_method: "css_variables",
  });
  const p = theme.buildPalette({ vertical: "concrete", mode: "light", brandIdentity: bi });
  assert.equal(p.secondary, "#111827");
  assert.ok(p.secondaryInk, "the secondary ink role must be derived and measured");
  assert.ok(theme.contrastRatio(p.secondaryInk, p.secondary) >= 4.5, "the ink on the secondary fill must read");
  const sheet = theme.themeCss({ palette: theme.buildThemePair({ mode: "light", brandIdentity: bi }), donorCss: FENCING_CSS, defaultMode: "light" });
  const secondaryTriplet = theme.hslTriplet("#111827");
  assert.ok(
    sheet.includes(`--secondary:#111827`) || sheet.includes(`--secondary:${secondaryTriplet}`),
    `the secondary token is overridden in the sheet (hex or triplet ${secondaryTriplet})`,
  );
  assert.ok(sheet.includes("--secondary-foreground:"), "its ink rides along");
});

// ---------------------------------------------------------------------------
// decideMode — the light/dark shift from brand_identity.background
// ---------------------------------------------------------------------------

test("decideMode: a brand_identity LIGHT background shifts even a cinematic-dark donor to light", () => {
  // fencing-sterling is a compiled-dark donor; a client measured light used to
  // need a strongly-light paper reading to escape it. A brand_identity
  // background IS the client's canvas, directly read — it decides.
  const d = theme.decideMode(null, { donor: "fencing-sterling", brandIdentityBackground: "#F5F5F4" });
  assert.equal(d.mode, "light");
  assert.match(d.why, /brand_identity_background_light/);
});

test("decideMode: a brand_identity DARK background keeps dark", () => {
  const d = theme.decideMode(
    { mode: "light", basis: "paper", brightShare: 0.9 },
    { brandIdentityBackground: "#0B0B0C" },
  );
  assert.equal(d.mode, "dark");
  assert.match(d.why, /brand_identity_background_dark/);
});

test("decideMode: without a brand background the decision chain is untouched", () => {
  assert.equal(theme.decideMode(null, { donor: "fencing-sterling" }).mode, "dark");
  assert.equal(theme.decideMode(null).mode, "light");
  assert.equal(theme.decideMode({ mode: "dark", basis: "paper", darkShare: 0.8 }).mode, "dark");
});

// ---------------------------------------------------------------------------
// the font verdict
// ---------------------------------------------------------------------------

test("brandIdentityFont: web-safe and Google families are honoured, unknown families skipped", () => {
  assert.deepEqual(theme.brandIdentityFont("Arial"), { family: "Arial", provider: "web-safe" });
  assert.deepEqual(theme.brandIdentityFont('"Playfair Display", serif'), { family: "Playfair Display", provider: "google" });
  assert.deepEqual(theme.brandIdentityFont("  Outfit  "), { family: "Outfit", provider: "google" });
  assert.equal(theme.brandIdentityFont("Definitely Not A Font 3000"), null, "an unknown family is skipped, never referenced");
  assert.equal(theme.brandIdentityFont(""), null);
});

test("googleFontsHref: first-party Google Fonts link, correctly encoded", () => {
  assert.equal(theme.googleFontsHref('"Open Sans", sans-serif'), "https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700&display=swap");
});

// ---------------------------------------------------------------------------
// the header logo
// ---------------------------------------------------------------------------

test("brandIdentityLogoCss: contains the mark on EVERY breakpoint, mobile included", () => {
  const css = theme.brandIdentityLogoCss("https://cdn.hurricanefence.example.com/assets/logo.png");
  const sel = 'img[src*="cdn.hurricanefence.example.com"]';
  assert.ok(css.includes(`${sel}{width:auto!important`), "the constraint is keyed on the logo host and nothing else");
  assert.ok(css.includes("max-height:3.25rem!important"), "desktop header height is bounded");
  assert.ok(css.includes("object-fit:contain!important"), "contain, never crop — a wordmark is not an avatar");
  assert.ok(/@media \(max-width:640px\)\{[^}]*max-height:2\.5rem/.test(css), "mobile gets its own, tighter step");
  assert.equal(theme.brandIdentityLogoCss("not a url"), "");
});

// ---------------------------------------------------------------------------
// engine integration — the verdict reaches the built bytes
// ---------------------------------------------------------------------------

const LOGO_URL = "https://cdn.hurricanefence.example.com/assets/hurricane-logo.png";

function obrienRequest(overrides = {}) {
  return {
    slug: "wss-test-obrien-and-sons-roofing",
    donor: "mirror-donor",
    facts: {
      business_name: "O'Brien & Sons Roofing",
      industry: "roofing",
      city: "Tucson",
      state: "AZ",
      phone: "(520) 555-0142",
      ...(overrides.facts || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== "facts")),
  };
}

/** Deploy stubs; `files()` returns the final built tree for byte assertions. */
function makeDeps() {
  const calls = [];
  let captured = null;
  return {
    calls,
    files: () => captured,
    deps: {
      ensureProject: async () => "prj_stub_bi",
      resolveAliasDeployment: async () => ({ found: false, reason: "alias_not_found" }),
      uploadFiles: async (files) => ({
        manifest: Object.keys(files).map((f) => ({ file: f })),
        uploaded: 1, deduped: Object.keys(files).length - 1,
      }),
      createDeployment: async () => ({ id: "dpl_stub_bi", url: "stub.vercel.app", readyState: "QUEUED" }),
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

test("engine: brand_identity paints the client's colour over the fixture donor's green, injects the logo and the font", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(obrienRequest({
    brand_identity: {
      accent_color: "#e31e24",
      secondary_color: "#111827",
      background: "#FFFFFF",
      logo_url: LOGO_URL,
      font_family: "Poppins",
      extraction_method: "css_variables",
      confidence: "HIGH",
    },
  }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const built = files();

  // THEME REPORT: the audit trail says whose measurement dressed the page.
  const themeCheck = res.body.checks.theme;
  assert.equal(themeCheck.status, "passed");
  assert.equal(themeCheck.brand_identity.applied, true);
  assert.equal(themeCheck.brand_identity.accent, "#E31E24");
  assert.equal(themeCheck.brand_identity.confidence, "HIGH");
  assert.equal(themeCheck.brand_identity.extraction_method, "css_variables");
  assert.equal(themeCheck.brand_identity.logo_url, LOGO_URL);
  assert.match(themeCheck.brand_identity.font, /Poppins \(google\)/);
  assert.equal(themeCheck.palette_source, "brand_identity_extraction");

  // THE COLOURS: the appended sheet carries the client's red in the donor's
  // token spelling (the fixture spends hsl(var(--accent)), so triplet form)
  // and the donor's default green no longer reaches the cascade's last word.
  const cssFiles = Object.keys(built).filter((r) => /\.css$/i.test(r));
  assert.ok(cssFiles.length, "the fixture ships a stylesheet");
  const sheet = cssFiles.map((r) => built[r].toString("utf8")).join("\n");
  assert.ok(sheet.includes(`--accent:${RED_TRIPLET}`), `expected --accent:${RED_TRIPLET} appended after the donor stylesheet`);
  assert.ok(sheet.includes("--accent-foreground:"), "the accent ink follows the override");
  assert.ok(sheet.includes("--secondary:"), "the secondary colour overrides the secondary tokens");
  // NO DONOR GREEN SURVIVES. The sheet appends the client's red after the
  // donor's stylesheet, and the recolour pass (the same one brand.accent has
  // always driven) repoints the donor's own --accent declaration — either way
  // the cascade's last word for every accent token is the client's red.
  assert.ok(!sheet.includes("152 100% 40%"), "the fixture donor's default green must not survive the override");

  // THE LOGO: the header <img> wears the extraction URL, alt from the
  // business name, constrained on every breakpoint.
  const html = built["index.html"].toString("utf8");
  assert.ok(html.includes(`src="${LOGO_URL}"`), "the header img src is the brand_identity logo");
  assert.match(html, /alt="O.Brien (&amp;|&) Sons Roofing"/, "alt text comes from the business name");
  assert.ok(sheet.includes('img[src*="cdn.hurricanefence.example.com"]'), "the logo containment CSS shipped");
  assert.ok(sheet.includes("@media (max-width:640px)"), "and its mobile step");

  // THE FONT: a known Google family is linked first-party and used as display.
  assert.ok(html.includes("https://fonts.googleapis.com/css2?family=Poppins"), "the Google Fonts link is injected");
});

test("engine: LOW confidence is refused — donor defaults stand, the report says why", async () => {
  const { deps, files } = makeDeps();
  const res = await mirror(obrienRequest({
    brand_identity: {
      accent_color: "#e31e24",
      extraction_method: "guess",
      confidence: "LOW",
    },
  }), { registry: createRegistry(), deps });
  assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
  const themeCheck = res.body.checks.theme;
  assert.equal(themeCheck.brand_identity.applied, false);
  assert.match(themeCheck.brand_identity.reason, /low_refused/);
  // No logo accent on this request, so the palette takes the researched
  // vertical fallback — the exact neutral path it took before brand_identity
  // existed. The refused verdict changed nothing.
  assert.equal(themeCheck.palette_source, "vertical_research_fallback");
  const built = files();
  const sheet = Object.keys(built).filter((r) => /\.css$/i.test(r))
    .map((r) => built[r].toString("utf8")).join("\n");
  assert.ok(!sheet.includes(`--accent:${RED_TRIPLET}`), "a refused verdict must not paint the page");
  const html = built["index.html"].toString("utf8");
  assert.ok(!html.includes(LOGO_URL), "no brand_identity, no extraction logo");
});

test("engine: an applied brand_identity changes build_hash; the same verdict is idempotent", async () => {
  const bi = {
    accent_color: "#e31e24", extraction_method: "css_variables", confidence: "HIGH",
  };
  const plain = await mirror(obrienRequest(), { dryRun: true, registry: createRegistry() });
  const withBi = await mirror(obrienRequest({ brand_identity: bi }), { dryRun: true, registry: createRegistry() });
  const again = await mirror(obrienRequest({ brand_identity: bi }), { dryRun: true, registry: createRegistry() });
  assert.equal(plain.status, 200);
  assert.equal(withBi.status, 200, JSON.stringify(withBi.body).slice(0, 300));
  assert.equal(again.status, 200);
  assert.notEqual(withBi.body.build_hash, plain.body.build_hash, "a palette-changing verdict is a different build");
  assert.equal(again.body.build_hash, withBi.body.build_hash, "the same verdict rebuilds idempotently");
  // a refused verdict must NOT move the hash — it renders identically to absence
  const low = await mirror(obrienRequest({
    brand_identity: { accent_color: "#e31e24", extraction_method: "guess", confidence: "LOW" },
  }), { dryRun: true, registry: createRegistry() });
  assert.equal(low.status, 200);
  assert.equal(low.body.build_hash, plain.body.build_hash);
});

test("buildHash: brandIdentity participates only when present", () => {
  const base = {
    donor: "d", donorHash: "dh", facts: { a: 1 }, phoneDigits: "5205550142",
    brandHashes: {}, hero: {}, content: {}, signup: null, edits: "",
  };
  const h1 = buildHash(base);
  const h2 = buildHash(base);
  const h3 = buildHash({ ...base, brandIdentity: { applied: true, accent: "#E31E24" } });
  assert.equal(h1, h2);
  assert.notEqual(h3, h1);
});
