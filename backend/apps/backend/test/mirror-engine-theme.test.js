"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const theme = require("../lib/mirror-engine/theme");

const DONOR_CSS = path.join(__dirname, "..", "donors-clean", "hvac-premier", "assets", "index-DQtU08a3.css");
// A SECOND DONOR THAT PAINTS DARK A COMPLETELY DIFFERENT WAY. hvac-premier
// bakes literals into Tailwind arbitrary values and names its slab ink
// `--primary-foreground`; plumbing-clean declares `--slurry` / `--bone` and
// spends them through gradient utilities. Every generalisation below exists
// because the first version worked on one and did nothing on the other.
const DONOR2_CSS = path.join(
  __dirname, "..", "donors-clean", "plumbing-clean", "assets",
  fs.readdirSync(path.join(__dirname, "..", "donors-clean", "plumbing-clean", "assets"))
    .find((f) => /^index-.*\.css$/.test(f)),
);

// ---------------------------------------------------------------------------
// the decision
// ---------------------------------------------------------------------------

test("decideMode: light is the default when nothing was measured", () => {
  const d = theme.decideMode(null);
  assert.equal(d.mode, "light");
  assert.equal(d.measured, false);
  assert.match(d.why, /default_light/);
});

test("decideMode: a client site measured light stays light", () => {
  assert.equal(theme.decideMode({ mode: "light", basis: "paper", brightShare: 0.86 }).mode, "light");
});

test("decideMode: a client site measured genuinely dark keeps dark", () => {
  const d = theme.decideMode({ mode: "dark", basis: "paper", brightShare: 0.09, darkShare: 0.71 });
  assert.equal(d.mode, "dark");
  assert.equal(d.measured, true);
});

test("decideMode: a hero-only reading is never grounds for dark", () => {
  // The measurement script falls back to the hero when a page has nothing below
  // the fold. A dark photographic hero is not a dark website, and treating it
  // as one is exactly the mistake that called 20 of 42 light sites dark.
  const d = theme.decideMode({ mode: "dark", basis: "hero-only", brightShare: 0.11 });
  assert.equal(d.mode, "light");
  assert.match(d.why, /hero_only/);
});

test("decideMode: 'mid' is not dark", () => {
  assert.equal(theme.decideMode({ mode: "mid", basis: "paper", brightShare: 0.44 }).mode, "light");
});

// ---------------------------------------------------------------------------
// contrast — the part that must never regress
// ---------------------------------------------------------------------------

const SAMPLE_BRANDS = [
  ["deep blue", "#0C449A", "#094463"],
  ["teal", "#1B7D9F", "#094463"],
  ["safety orange", "#FF7A14", "#102541"],
  ["bright amber", "#FFC107", "#3E2723"],   // the classic white-text failure
  ["pale gold", "#F2D青".replace("青", "58"), "#4A3B10"],
  ["crimson", "#C53F34", "#2B1B18"],
  ["near-black brand", "#111827", "#374151"],
  ["greyscale mark", "#8A8A8A", "#B0B0B0"], // must fall back, not ship a grey brand
];

for (const [label, accent, primary] of SAMPLE_BRANDS) {
  for (const mode of ["light", "dark"]) {
    test(`palette clears 4.5:1 everywhere — ${label} (${mode})`, () => {
      const p = theme.buildPalette({ accent, primary, vertical: "hvac", mode });
      assert.deepEqual(p.contrastFailures, [], `failing roles: ${p.contrastFailures.join(", ")} => ${JSON.stringify(p.contrast)}`);
      assert.equal(p.passes, true);
      // Body copy is held to a harder bar than the 4.5 floor.
      assert.ok(p.contrast.text_on_surface >= 7, `body text ${p.contrast.text_on_surface}:1 should clear 7`);
    });
  }
}

test("light mode is genuinely light, dark mode is genuinely dark", () => {
  const light = theme.buildPalette({ accent: "#0C449A", vertical: "hvac", mode: "light" });
  const dark = theme.buildPalette({ accent: "#0C449A", vertical: "hvac", mode: "dark" });
  assert.ok(theme.relativeLuminance(light.surface) > 0.85, `light surface ${light.surface}`);
  assert.ok(theme.relativeLuminance(light.slab) > 0.8, `light slab ${light.slab} must not be a dark band`);
  assert.ok(theme.relativeLuminance(dark.surface) < 0.05, `dark surface ${dark.surface}`);
});

test("light mode is not the dark mode inverted", () => {
  // An inversion would put the light surface at exactly 1 - darkSurface and
  // reuse the same inks. Both palettes are built independently, so the derived
  // roles differ by more than a flip.
  const light = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "light" });
  const dark = theme.buildPalette({ accent: "#1B7D9F", vertical: "plumbing", mode: "dark" });
  assert.notEqual(light.text, dark.surface);
  assert.notEqual(light.surface, dark.text);
  assert.notEqual(light.muted, dark.muted);
});

test("a bright accent gets dark button text rather than a darkened brand colour", () => {
  // Owner's rule reduced to a test: their colour stays their colour.
  const p = theme.buildPalette({ accent: "#FFC107", vertical: "hvac", mode: "light" });
  assert.equal(p.accent, "#FFC107", "the accent itself must be untouched");
  assert.ok(theme.contrastRatio(p.accentInk, p.accent) >= 4.5);
  assert.ok(theme.relativeLuminance(p.accentInk) < 0.2, "amber must carry dark ink, not white");
});

test("a dark accent still carries white button text", () => {
  const p = theme.buildPalette({ accent: "#0C449A", vertical: "hvac", mode: "light" });
  assert.equal(p.accent, "#0C449A");
  assert.ok(theme.relativeLuminance(p.accentInk) > 0.8, "a deep blue should take white ink");
});

test("a greyscale logo falls back to the researched vertical palette and says so", () => {
  const p = theme.buildPalette({ accent: "#8A8A8A", vertical: "plumbing", mode: "light" });
  assert.equal(p.source, "vertical_research_fallback");
  assert.equal(p.fallbackName, "Clean Water Blue");
  assert.equal(p.accent, theme.VERTICAL_PALETTES.plumbing.accent);
});

test("a real client colour is preferred over the fallback", () => {
  const p = theme.buildPalette({ accent: "#C53F34", vertical: "roofing", mode: "light" });
  assert.equal(p.source, "client_logo");
  assert.equal(p.accent, "#C53F34");
  assert.equal(p.fallbackName, null);
});

test("every researched fallback palette itself clears 4.5:1", () => {
  for (const [key, fb] of Object.entries(theme.VERTICAL_PALETTES)) {
    const p = theme.buildPalette({ accent: fb.accent, vertical: key, mode: "light" });
    assert.deepEqual(p.contrastFailures, [], `${key}/${fb.name}: ${JSON.stringify(p.contrast)}`);
  }
});

test("unknown verticals resolve to a real palette rather than throwing", () => {
  const p = theme.fallbackPalette("underwater basket weaving");
  assert.equal(p.vertical, "generic");
  assert.ok(theme.normalizeHex(p.accent));
});

test("vertical aliases resolve (masonry -> concrete, med spa -> medspa)", () => {
  assert.equal(theme.fallbackPalette("masonry").vertical, "concrete");
  assert.equal(theme.fallbackPalette("med spa").vertical, "medspa");
  assert.equal(theme.fallbackPalette("Heating and Air").vertical, "hvac");
});

// ---------------------------------------------------------------------------
// reading the donor
// ---------------------------------------------------------------------------

test("finds the hardcoded dark slabs in the real hvac-premier stylesheet", () => {
  const css = fs.readFileSync(DONOR_CSS, "utf8");
  const found = theme.darkSurfaceSelectors(css);
  // Measured on the live mirror: bg-[hsl(215_65%_7%)], _8%, _9% and
  // bg-[hsl(215_60%_12%)] are the four full-bleed dark bands.
  assert.ok(found.arbitrary.length >= 4, `expected >=4 arbitrary dark bg rules, got ${found.arbitrary.length}`);
  assert.ok(found.arbitrary.every((a) => a.l <= 22));
  // --primary: 215 60% 16% is the CTA band and the footer.
  assert.ok(found.tokens.includes("primary"), "the dark --primary token must be caught");
  assert.equal(found.primaryLightness, 16);
});

test("catches the TRANSLUCENT glass variants of the same dark slab", () => {
  // Four cards float over the hero photo at bg-[hsl(215_65%_8%/0.6)] and
  // friends. In the stylesheet the alpha's decimal point is escaped — `0\.6` —
  // so a `[\d.]+` alpha group matches nothing and the rule reads as opaque.
  // That shipped once: the cards stayed dark while their text went dark.
  const css = fs.readFileSync(DONOR_CSS, "utf8");
  const glass = theme.darkSurfaceSelectors(css).arbitrary.filter((a) => a.alpha < 1);
  const alphas = [...new Set(glass.map((g) => g.alpha))].sort((a, b) => a - b);
  assert.deepEqual(alphas, [0.6, 0.7, 0.78, 0.88], `got ${JSON.stringify(alphas)}`);
});

test("the glass cards keep their opacity but become a light translucent", () => {
  const { css } = sheetFor();
  assert.match(css, /color-mix\(in srgb,var\(--wss-slab\) 60%,transparent\)!important/);
  assert.match(css, /color-mix\(in srgb,var\(--wss-slab\) 88%,transparent\)!important/);
});

test("does not mistake a LIGHT arbitrary background for a slab", () => {
  const css = ".bg-\\[hsl\\(210_30\\%_98\\%\\)\\]{background-color:hsl(210 30% 98%)}";
  assert.equal(theme.darkSurfaceSelectors(css).arbitrary.length, 0);
});

// --- the second donor, which names everything differently -------------------

test("finds a NAMED dark surface token on the plumbing donor", () => {
  // The first version detected zero slabs here and the render was byte-identical
  // before and after — 62% light either way. The dark is `--slurry`, not a
  // literal.
  const css = fs.readFileSync(DONOR2_CSS, "utf8");
  const d = theme.darkSurfaceSelectors(css);
  assert.deepEqual(d.arbitrary, [], "this donor has no arbitrary-value slabs");
  assert.ok(d.darkVars.includes("--slurry"), `got ${JSON.stringify(d.darkVars)}`);
  assert.ok(d.bgUtilities.includes(".bg-slurry"));
  assert.ok(d.gradientFrom.length >= 1 && d.gradientTo.length >= 1 && d.gradientVia.length >= 1);
});

test("a bare number in a custom property is not a colour", () => {
  // `--font-weight-light: 300` parsed as the 3-digit hex #330000 and five
  // font-weight tokens were classified as dark surfaces.
  const found = theme.darkCustomProperties("--font-weight-light:300;--tracking:0.32;--x:#000000");
  assert.ok(!found.has("--font-weight-light"), "300 is a weight, not a colour");
  assert.ok(!found.has("--tracking"));
  assert.ok(found.has("--x"));
});

test("a foreground-role token is never mistaken for a surface", () => {
  const found = theme.darkCustomProperties("--primary-foreground:215 60% 10%;--primary:215 60% 16%");
  assert.ok(!found.has("--primary-foreground"));
  assert.ok(found.has("--primary"));
});

test("light text utilities are found so a flipped slab keeps legible ink", () => {
  // `.text-bone` is near-white. It can only ever have been legible over
  // something dark, so when the slabs go light it has to go dark with them.
  const css = fs.readFileSync(DONOR2_CSS, "utf8");
  const { vars, selectors } = theme.lightTextUtilities(css);
  assert.ok(vars.includes("--bone"), `got ${JSON.stringify(vars)}`);
  assert.ok(selectors.some((s) => s.startsWith(".text-bone")), `got ${JSON.stringify(selectors)}`);
});

test("the plumbing donor's slabs and ink both get overridden", () => {
  const css = fs.readFileSync(DONOR2_CSS, "utf8");
  const palette = theme.buildThemePair({ accent: "#1B7D9F", primary: "#094463", vertical: "plumbing", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: css, defaultMode: "light" });
  assert.match(sheet, /\.bg-slurry\b/, "the flat dark background must be repointed");
  assert.match(sheet, /--tw-gradient-from:var\(--wss-slab\)/, "gradient stops must be repointed");
  assert.match(sheet, /\.text-bone[^{]*\{color:var\(--wss-slab-ink\)\}/, "the slab ink must flip with the slab");
});

test("a translucent named-colour scrim keeps its opacity", () => {
  // Tailwind v4 emits `.bg-slurry\/15` twice — a flat fallback and the real
  // color-mix. An override appended at the end beats both, so a flat colour
  // here would turn a 15% wash over a photograph into a solid panel.
  const css = fs.readFileSync(DONOR2_CSS, "utf8");
  const palette = theme.buildThemePair({ accent: "#1B7D9F", vertical: "plumbing", mode: "light" });
  const sheet = theme.themeCss({ palette, donorCss: css, defaultMode: "light" });
  assert.match(sheet, /color-mix\(in oklab,var\(--wss-slab\) 15%,transparent\)/);
  assert.match(sheet, /color-mix\(in oklab,var\(--wss-slab\) 60%,transparent\)/);
});

test("finds the animated blur layers", () => {
  const css = fs.readFileSync(DONOR_CSS, "utf8");
  const found = theme.auroraSelectors(css);
  assert.ok(found.includes("aurora"), `got ${JSON.stringify(found)}`);
  assert.ok(found.includes("aurora-soft"));
});

// ---------------------------------------------------------------------------
// the emitted stylesheet
// ---------------------------------------------------------------------------

function sheetFor(opts = {}) {
  const css = fs.readFileSync(DONOR_CSS, "utf8");
  const palette = theme.buildThemePair({ accent: "#C53F34", primary: "#2B1B18", vertical: "hvac", ...opts });
  return { css: theme.themeCss({ palette, donorCss: css, defaultMode: palette.mode }), palette };
}

test("the sheet repoints the donor's dark slabs at one variable", () => {
  const { css } = sheetFor();
  assert.match(css, /--wss-slab:#/);
  assert.match(css, /\.bg-\\\[hsl\\\(215_65\\%_8\\%\\\)\\\]/, "the hero's arbitrary class must be overridden");
  assert.match(css, /\.bg-primary/, "the CTA band and footer must be overridden");
  assert.match(css, /background-color:var\(--wss-slab\)!important/);
});

test("the sheet flips --primary-foreground, which carries every slab alpha variant", () => {
  // The donor writes slab text, hairlines and glass fills as
  // hsl(var(--primary-foreground) / α). This one override moves all of them.
  const { css, palette } = sheetFor();
  assert.match(css, /--primary-foreground:/);
  const expected = theme.hslTriplet(palette.slabInk);
  assert.ok(css.includes(`--primary-foreground:${expected}`), `expected --primary-foreground:${expected}`);
});

test("the blurry motion is recoloured to the client accent, never the donor's", () => {
  const { css } = sheetFor();
  assert.match(css, /\.aurora[^{]*\{[^}]*--wss-accent/);
  // The donor's own hues must not survive in our override.
  assert.ok(!/hsl\(18 92%/.test(css), "donor orange must not appear");
  assert.ok(!/hsl\(200 85%/.test(css), "donor blue must not appear");
});

test("the wash is capped harder in light mode than in dark", () => {
  // Read the AURORA rule specifically. A looser regex picked up the first
  // `var(--wss-accent) N%` in the file, which belongs to --gradient-hero and is
  // the same constant in both modes — so the test passed nothing and failed for
  // the wrong reason.
  const auroraPct = (s) => {
    const rule = /\.aurora[^{]*\{([^}]*)\}/.exec(s);
    assert.ok(rule, "no aurora override rule emitted");
    return Number(/var\(--wss-accent\) (\d+)%/.exec(rule[1])[1]);
  };
  const light = auroraPct(sheetFor({ mode: "light" }).css);
  const dark = auroraPct(sheetFor({ mode: "dark" }).css);
  assert.ok(light < dark, `light ${light}% should be quieter than dark ${dark}%`);
  assert.ok(light <= 25, "a light-mode wash above ~25% starts eating text contrast");
});

test("both themes are emitted so the toggle has somewhere to go", () => {
  const { css } = sheetFor({ mode: "light" });
  assert.match(css, /\[data-wss-theme="light"\]/);
  assert.match(css, /\[data-wss-theme="dark"\]/);
});

test("gradient-clipped display text stays a text mask, not a filled block", () => {
  // The `background` SHORTHAND resets every background-* longhand, so
  // `background:…!important` set background-clip:border-box at !important
  // weight and beat the `background-clip:text` written after it. The hero
  // rendered a solid red rectangle where the headline should have been.
  const { css } = sheetFor();
  const rule = /\.text-gradient-warm\{([^}]*)\}/.exec(css);
  assert.ok(rule, "no text-gradient-warm override emitted");
  assert.ok(!/(^|;)\s*background:/.test(rule[1]), "must not use the background shorthand");
  assert.match(rule[1], /background-image:linear-gradient/);
  assert.match(rule[1], /background-clip:text!important/);
  assert.match(rule[1], /-webkit-background-clip:text!important/);
});

test("a metallic/gradient brand keeps its sweep instead of being flattened", () => {
  // Owner's "Platinum Plumbing": a brushed-metal wordmark over white.
  const { css } = sheetFor({
    gradient: { angle: 135, stops: ["#B8BDC4", "#EDEFF2", "#8E959E"] },
  });
  assert.match(css, /--wss-accent-gradient:linear-gradient\(135deg,#B8BDC4 0%,#EDEFF2 50%,#8E959E 100%\)/);
  assert.match(css, /background-image:var\(--wss-accent-gradient\)!important/);
});

test("no gradient declared means no gradient rule invented", () => {
  const { css } = sheetFor();
  assert.ok(!css.includes("--wss-accent-gradient"));
});

// ---------------------------------------------------------------------------
// the toggle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// the donor's PAPER, for a client whose own site is dark
// ---------------------------------------------------------------------------

// A miniature of what plumbing-clean actually ships: a private light colour and
// a private dark one, each spent through flat and alpha utilities.
const PAPER_DONOR = [
  ":root{--bone:oklch(96% 0.032 135.1);--slurry:oklch(12% 0.083 135.1);--font-weight-light:300}",
  ".bg-bone{background-color:var(--bone)}",
  ".bg-bone\\/15{background-color:var(--bone)}",
  ".bg-bone\\/85{background-color:var(--bone)}",
  ".bg-slurry{background-color:var(--slurry)}",
  ".text-slurry{color:var(--slurry)}",
  ".text-slurry\\/60{color:var(--slurry)}",
  ".text-bone{color:var(--bone)}",
].join("\n");

test("the donor's own light paper is found, alpha ladder included", () => {
  const paper = theme.lightSurfaceSelectors(PAPER_DONOR);
  assert.deepStrictEqual(paper.bgUtilities.sort(), [".bg-bone", ".bg-bone\\/15", ".bg-bone\\/85"].sort());
  // `--font-weight-light: 300` is a number, not the colour #330000.
  assert.ok(!paper.vars.includes("--font-weight-light"));

  const ink = theme.darkTextUtilities(PAPER_DONOR);
  assert.deepStrictEqual(ink.selectors.sort(), [".text-slurry", ".text-slurry\\/60"].sort());
});

test("a faded ink step is carried, and never faded past legibility", () => {
  // SHIPPED AND CAUGHT BY LOOKING. With the header repointed to the dark
  // surface and only the solid `.text-slurry` following it, Gunther's nav —
  // WORK CRAFT TOOLS AREA QUOTE, all `text-slurry\/70` — went near-black on
  // near-black.
  const donor = [
    ":root{--slurry:oklch(12% 0.083 135.1);--bone:oklch(96% 0.032 135.1)}",
    ".bg-bone{background-color:var(--bone)}",
    ".text-slurry\\/70{color:var(--slurry)}",
    ".text-slurry\\/40{color:var(--slurry)}",
  ].join("\n");
  const palette = theme.buildThemePair({ accent: "#ED1C24", vertical: "plumbing", mode: "dark" });
  const sheet = theme.themeCss({ palette, donorCss: donor, defaultMode: "dark" });

  const at70 = sheet.split("\n").find((l) => l.includes(".text-slurry\\/70{"));
  assert.ok(at70.includes("color-mix(in oklab,var(--wss-text) 70%,transparent)"),
    `70% keeps its own step — got ${at70}`);

  // 40% cannot clear 4.5:1 on any surface, so it is lifted to the floor rather
  // than shipped as a caption nobody can read.
  const at40 = sheet.split("\n").find((l) => l.includes(".text-slurry\\/40{"));
  assert.ok(at40.includes("color-mix(in oklab,var(--wss-text) 55%,transparent)"),
    `a step below the floor is lifted to it — got ${at40}`);
});

test("each step of the paper's alpha ladder keeps its own opacity", () => {
  // Gunther's sticky header is `bg-bone\/85 backdrop-blur-md`. Flattening it to
  // an opaque colour kills the blur the design is built on; dropping the rule
  // leaves a dusty-rose band across the top of a dark page.
  const palette = theme.buildThemePair({ accent: "#ED1C24", vertical: "plumbing", mode: "dark" });
  const sheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "dark" });

  const flat = sheet.split("\n").find((l) => /\.bg-bone\{/.test(l));
  assert.match(flat, /\{background-color:var\(--wss-surface\)\}$/);

  for (const pct of [15, 85]) {
    const rule = sheet.split("\n").find((l) => l.includes(`.bg-bone\\/${pct}{`));
    assert.ok(rule, `no rule for the ${pct}% step`);
    assert.ok(
      rule.includes(`color-mix(in oklab,var(--wss-surface) ${pct}%,transparent)`),
      `the ${pct}% step must stay ${pct}% — got ${rule}`,
    );
  }
});

test("a token the theme already re-declares is off-limits to the paper pass", () => {
  // Without this, `.bg-border` was claimed on two donors — every hairline would
  // have become a full-width slab of page colour in dark mode.
  const shadcn = [
    ":root{--background:0 0% 100%;--border:210 20% 94%;--secondary-foreground:213 45% 14%}",
    ".bg-background{background-color:var(--background)}",
    ".bg-border{background-color:var(--border)}",
  ].join("\n");
  const owned = new Set(["--background", "--border"]);
  assert.deepStrictEqual(theme.lightSurfaceSelectors(shadcn, { owned }).bgUtilities, []);
  assert.ok(theme.lightSurfaceSelectors(shadcn).bgUtilities.length > 0,
    "and without the exclusion it would have claimed them — proving the guard is load-bearing");
});

test("the paper repoint is emitted for dark ONLY, so a light mirror is untouched", () => {
  const palette = theme.buildThemePair({ accent: "#ED1C24", vertical: "plumbing", mode: "light" });
  const lightSheet = theme.themeCss({ palette, donorCss: PAPER_DONOR, defaultMode: "light" });
  // In a light-default build the rule exists but is gated behind the dark
  // attribute, which nothing sets unless the visitor asks for it.
  const paperRule = lightSheet.split("\n").find((l) => l.includes(".bg-bone{background-color:var(--wss-surface)}"));
  assert.ok(paperRule, "the rule is present");
  assert.match(paperRule, /\[data-wss-theme="dark"\] \.bg-bone/);
  assert.ok(!/:root:not/.test(paperRule), "a light-default build must not apply it at :root");

  // And in a dark-default build it applies by default, and yields to the toggle.
  const darkPalette = theme.buildThemePair({ accent: "#ED1C24", vertical: "plumbing", mode: "dark" });
  const darkSheet = theme.themeCss({ palette: darkPalette, donorCss: PAPER_DONOR, defaultMode: "dark" });
  const darkRule = darkSheet.split("\n").find((l) => l.includes(".bg-bone{background-color:var(--wss-surface)}"));
  assert.match(darkRule, /:root:not\(\[data-wss-theme="light"\]\) \.bg-bone/);
});

test("a donor with no private paper colour gets no paper rules at all", () => {
  const palette = theme.buildThemePair({ accent: "#C53F34", vertical: "hvac", mode: "dark" });
  const sheet = theme.themeCss({
    palette,
    donorCss: ":root{--background:210 20% 99%}\n.bg-background{background-color:hsl(var(--background))}",
    defaultMode: "dark",
  });
  assert.ok(!sheet.includes("background-color:var(--wss-surface)}"),
    "we never invent a surface role in a design we did not draw");
});

test("the boot script sets the theme attribute before paint and defaults light", () => {
  const s = theme.themeBootScript("light");
  assert.match(s, /data-wss-theme/);
  assert.match(s, /localStorage/);
  assert.ok(s.includes('"light"'));
});

test("a light-default site ignores an OS dark preference on first visit", () => {
  // The owner's rule: a light site is light because that client's own brand is
  // light — that is the thing we are showing them.
  const s = theme.themeBootScript("light");
  assert.ok(!/prefers-color-scheme/.test(s), "must not switch a light site to dark for OS preference");
});

test("a dark-default site actually boots dark — no OS query gets to overrule it", () => {
  // REGRESSION. The first version consulted
  // `matchMedia("(prefers-color-scheme: light)")` for dark-default sites, on the
  // theory that it was yielding to an explicit light preference. There is no
  // such signal: `no-preference` is gone from the spec, so every browser that
  // has never been told anything — including headless Chromium and a stock
  // Windows install — answers `light`. Gunther Plumbing's mirror was built
  // dark, served HTML that said dark, and rendered white.
  const s = theme.themeBootScript("dark");
  assert.ok(!/prefers-color-scheme/.test(s), "an OS media query must not be able to overrule a measured dark site");
  assert.match(s, /setAttribute\("data-wss-theme",m\)/);

  // And prove the branch by running it: no stored choice -> the measured mode.
  const run = (stored, mode) => {
    const calls = [];
    const sandbox = {
      localStorage: { getItem: () => stored },
      document: { documentElement: {
        setAttribute: (k, v) => calls.push([k, v]),
        // THE CLASS TWIN (two-worlds fix): the boot script must drive the
        // shadcn `.dark` class beside our attribute, or every donor rule
        // keyed on the class world stays stranded — the measured cause of the
        // invisible dark-mode footers on the 2026-08-20 audit.
        classList: { toggle: (name, on) => calls.push(["class", name, Boolean(on)]) },
      } },
      // Deliberately reporting a LIGHT OS preference, the case that broke it.
      matchMedia: () => ({ matches: true }),
    };
    const body = theme.themeBootScript(mode).replace(/^<script>|<\/script>$/g, "");
    // eslint-disable-next-line no-new-func
    new Function("localStorage", "document", "window", "matchMedia", body)(
      sandbox.localStorage, sandbox.document, sandbox, sandbox.matchMedia,
    );
    return calls;
  };
  assert.deepStrictEqual(run(null, "dark"), [["data-wss-theme", "dark"], ["class", "dark", true]]);
  assert.deepStrictEqual(run(null, "light"), [["data-wss-theme", "light"], ["class", "dark", false]]);
  // A visitor's own stored choice still wins in both directions.
  assert.deepStrictEqual(run("light", "dark"), [["data-wss-theme", "light"], ["class", "dark", false]]);
  assert.deepStrictEqual(run("dark", "light"), [["data-wss-theme", "dark"], ["class", "dark", true]]);
  // Junk in localStorage is not a choice.
  assert.deepStrictEqual(run("purple", "dark"), [["data-wss-theme", "dark"], ["class", "dark", true]]);
});

test("the toggle markup is a real control and remembers the choice", () => {
  const html = theme.themeToggleHtml();
  assert.match(html, /<button[^>]+data-wss-theme-toggle/);
  assert.match(html, /aria-label=/);
  assert.match(html, /localStorage\.setItem/);
  assert.match(html, /aria-pressed/);
});
