"use strict";

/**
 * test/brand-cascade-mobile.test.js
 *
 * THE BRAND CASCADE COMPLETENESS LAW (2026-09-02, Hurricane Fence lane).
 *
 * A CSS custom-property override cascades to every rule that REFERENCES the
 * property — and to NO rule that hard-codes the same colour. The donor
 * bundles carried brand-coloured literals (`#e8a530` gradient text, a gold
 * `::selection`, gold box-shadow glows, a conic ring, hazard-tape charcoal,
 * baked signal utilities) that no `--accent` override could ever reach, and
 * the prerender HTML carried its own gold link colour that no CSS pass even
 * scanned (it only walked .css/.js). Every converted donor now satisfies:
 *
 *   change `--accent` to red → ZERO instances of the donor default colour
 *   remain in any CSS or HTML source, at EVERY breakpoint (the converted
 *   rules are token-driven and top-level, so no @media can out-cascade them),
 *   in LIGHT and DARK (no dark block hard-codes the accent family), and the
 *   client LOGO renders on mobile from first paint.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fleetPolish = require("../lib/mirror-engine/fleet-polish");
const { applyFontsToCss } = require("../lib/capture-brand.js");

const DONORS = path.join(__dirname, "..", "donors-clean");

function donorFiles(donor) {
  const dir = path.join(DONORS, donor);
  const files = {};
  const index = path.join(dir, "index.html");
  if (fs.existsSync(index)) files["index.html"] = fs.readFileSync(index, "utf8");
  const assets = path.join(dir, "assets");
  if (fs.existsSync(assets)) {
    for (const f of fs.readdirSync(assets)) {
      if (f.endsWith(".css")) files[`assets/${f}`] = fs.readFileSync(path.join(assets, f), "utf8");
    }
  }
  return files;
}

function cssOf(donor) {
  const files = donorFiles(donor);
  const key = Object.keys(files).find((k) => k.endsWith(".css"));
  assert.ok(key, `${donor}: expected a CSS bundle`);
  return { key, css: files[key], files };
}

/** Comments are documentation, never declarations. Strip before counting. */
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract balanced {...} blocks that follow each @media prelude. */
function mediaBlocks(css) {
  const out = [];
  const re = /@media[^{]*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(css.slice(start, i - 1));
    re.lastIndex = i;
  }
  return out;
}

/** Extract .dark { ... } blocks (balanced), excluding .dark\: tailwind variants. */
function darkBlocks(css) {
  const out = [];
  const re = /(?:^|[},])\s*\.dark\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(css.slice(start, i - 1));
    re.lastIndex = i;
  }
  return out;
}

function occurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/* ------------------------------------------------------------------------- *
 * 1. THE RED TEST — fencing-sterling (Hurricane Fence), cascade completeness
 * ------------------------------------------------------------------------- */

const FENCING_GOLD_FAMILY = ["#e8a530", "#f6ce55", "#e0a63c", "#efece7", "#e8a5304d"];

test("fencing red test: changing --accent leaves ZERO donor-default gold in any source", () => {
  const files = donorFiles("fencing-sterling");
  for (const [rel, text] of Object.entries(files)) {
    const bare = /\.css$/.test(rel) ? stripCssComments(text) : text;
    for (const hex of FENCING_GOLD_FAMILY) {
      const count = occurrences(bare.toLowerCase(), hex);
      assert.equal(
        count, 0,
        `${rel}: ${count} instance(s) of donor gold ${hex} survive the brand override`
      );
    }
  }
});

test("fencing red test: the formerly gold rules now FOLLOW --accent (they resolve red)", () => {
  const { css } = cssOf("fencing-sterling");
  // The token change the palette layer injects.
  const overridden = `${css}\n:root{--accent:0 84.2% 60.2%}`;

  // .text-gradient — endpoints and light mid-stop all ride the token.
  const gradient = /(.text-gradient\{background:linear-gradient\(135deg,)([^}]*)\}/.exec(overridden);
  assert.ok(gradient, ".text-gradient rule must exist");
  const stops = gradient[2];
  assert.ok(
    stops.includes("hsl(var(--accent))") && stops.includes("color-mix(in srgb,hsl(var(--accent)) 62%,#fff)"),
    ".text-gradient stops must be token-driven, got: " + stops
  );
  assert.ok(!/#e8a530|#f6ce55/i.test(stops), ".text-gradient must not carry donor gold hexes");

  // ::selection (and its -moz twin) — accent-tinted background, themed ink.
  for (const sel of ["::selection", "::-moz-selection"]) {
    const rule = new RegExp(sel.replace(/[-]/g, "\\$&") + "\\{([^}]*)\\}").exec(overridden);
    assert.ok(rule, `${sel} rule must exist`);
    assert.ok(
      rule[1].includes("hsl(var(--accent) / .3)") && rule[1].includes("hsl(var(--foreground))"),
      `${sel} must be token-driven, got: ${rule[1]}`
    );
  }
});

test("fencing red test: cascade reaches EVERY breakpoint", () => {
  const { css } = cssOf("fencing-sterling");
  const bare = stripCssComments(css);
  // (a) No gold literal hides inside ANY media query.
  for (const block of mediaBlocks(bare)) {
    for (const hex of FENCING_GOLD_FAMILY) {
      assert.equal(occurrences(block.toLowerCase(), hex), 0,
        `donor gold ${hex} hides inside a @media block`);
    }
  }
  // (b) No media query re-declares the converted selectors with a colour,
  //     so the top-level token-driven rules win at 390px exactly as at 1440px.
  for (const block of mediaBlocks(bare)) {
    assert.ok(!/\.text-gradient\{/.test(block), ".text-gradient must not be re-declared in @media");
    assert.ok(!/::selection\{/.test(block), "::selection must not be re-declared in @media");
  }
  // (c) The donor ships no dark-scope block that could out-cascade an accent
  //     override (its .dark\\: utilities are token consumers, not definers).
  assert.deepEqual(darkBlocks(bare), [], "fencing must not define a .dark token block");
});

/* ------------------------------------------------------------------------- *
 * 2. THE MOBILE LOGO LAW — the mark renders from FIRST PAINT, every viewport
 * ------------------------------------------------------------------------- */

test("fencing: the prerender header carries the client logo, visible on mobile", () => {
  const html = donorFiles("fencing-sterling")["index.html"];
  // The logo slot flows through the same token the engine binds to the
  // verified brand asset ({{LOGO_URL}} → /assets/client-logo.* | wordmark).
  assert.ok(/<img\b[^>]*class="prerender-logo"[^>]*src="\{\{LOGO_URL\}\}"/.test(html),
    "prerender header must carry the {{LOGO_URL}} logo slot");
  assert.ok(/<img\b[^>]*class="prerender-logo"[^>]*alt="[^"]+"/.test(html),
    "the prerender logo must be named for screen readers");
  // The slot's style: explicit size + contain fit, and NEVER display:none or
  // a media-query hide — visible at 390px exactly as at 1440px.
  const styleRule = /\.prerender-logo\{([^}]*)\}/.exec(html);
  assert.ok(styleRule, ".prerender-logo style must exist in the prerender style block");
  assert.ok(/height:\s*48px/.test(styleRule[1]) && /width:\s*48px/.test(styleRule[1]),
    "the logo slot must have explicit dimensions");
  assert.ok(/object-fit:\s*cover|contain/.test(styleRule[1]), "the logo must keep its aspect");
  assert.ok(!/display:\s*none/.test(styleRule[1]), "the logo must never be display:none");
  // The prerender style block carries no @media at all — nothing can hide the
  // logo on small viewports.
  assert.equal(occurrences(html.slice(html.indexOf('id="prerender-style"'), html.indexOf("</style>")), "@media"), 0,
    "the prerender style block must not contain media queries that could hide the logo");
});

test("fencing: the hydrated header keeps the logo outside the desktop-only nav", () => {
  const js = fs.readFileSync(
    path.join(DONORS, "fencing-sterling", "assets", fs.readdirSync(path.join(DONORS, "fencing-sterling", "assets")).find((f) => f.startsWith("index-") && f.endsWith(".js"))),
    "utf8"
  );
  // The bar logo (h-12) sits in the always-visible brand link; the desktop
  // nav is the `hidden md:flex` sibling — the logo link must NOT carry that
  // hidden class, and must appear BEFORE the desktop-only container.
  const logoAt = js.indexOf('src:P.logoUrl,alt:`${P.name} logo`,className:"h-12 w-12');
  assert.ok(logoAt !== -1, "hydrated header logo (h-12) must exist in the bundle");
  const hiddenAt = js.indexOf('"hidden md:flex items-center gap-8"');
  assert.ok(hiddenAt !== -1, "desktop-only nav container must exist");
  assert.ok(logoAt < hiddenAt, "the bar logo must live OUTSIDE (before) the hidden md:flex nav");
  assert.ok(!js.slice(Math.max(0, logoAt - 200), logoAt).includes("hidden"),
    "no hidden/visibility class may precede the bar logo");
});

/* ------------------------------------------------------------------------- *
 * 3. TYPOGRAPHY CASCADE — a mobile-scoped font hard-code cannot exist
 * ------------------------------------------------------------------------- */

const ALL_DONORS = fs.readdirSync(DONORS).filter((d) => fs.statSync(path.join(DONORS, d)).isDirectory());

test("typography: NO donor declares font-family inside any @media block", () => {
  for (const donor of ALL_DONORS) {
    for (const [rel, text] of Object.entries(donorFiles(donor))) {
      if (!rel.endsWith(".css")) continue;
      const bare = stripCssComments(text);
      for (const block of mediaBlocks(bare)) {
        const count = occurrences(block, "font-family:");
        assert.equal(count, 0,
          `${donor}/${rel}: ${count} font-family declaration(s) inside @media would out-cascade the brand font`);
      }
    }
  }
});

test("typography: the brand font swap reaches fencing's hard-coded stacks", () => {
  const { css } = cssOf("fencing-sterling");
  const { css: out } = applyFontsToCss(css, { display: "Brand Display", body: "Brand Body" });
  assert.ok(out.includes('h1,h2,h3,h4,h5,h6{font-family:"Brand Display", Outfit,sans-serif}'),
    "heading stack must lead with the client face");
  assert.ok(out.includes('font-family:"Brand Body", Inter,sans-serif}'),
    "body stack must lead with the client face");
});

/* ------------------------------------------------------------------------- *
 * 4. DARK-MODE CASCADE — dark blocks define tokens, never accent literals
 * ------------------------------------------------------------------------- */

test("dark mode: every donor's .dark block carries ONLY custom-property declarations", () => {
  for (const donor of ALL_DONORS) {
    for (const [rel, text] of Object.entries(donorFiles(donor))) {
      if (!rel.endsWith(".css")) continue;
      for (const block of darkBlocks(text)) {
        for (const decl of block.split(";")) {
          const trimmed = decl.trim();
          if (!trimmed) continue;
          assert.match(trimmed, /^--[a-z0-9-]+\s*:/i,
            `${donor}/${rel}: dark block carries a non-token declaration: "${trimmed.slice(0, 60)}"`);
        }
      }
    }
  }
});

/* ------------------------------------------------------------------------- *
 * 5. THE DONOR SWEEP — the converted accent families are GONE everywhere
 * ------------------------------------------------------------------------- */

const CONVERTED_SWEEPS = [
  { donor: "fencing-sterling", hexes: ["#e8a530", "#f6ce55", "#e0a63c", "#efece7", "#e8a5304d"] },
  { donor: "plumbing-premier", hexes: ["#f7ca36", "#f9d86c", "#184781", "#2b69b6"] },
  { donor: "roofing-falcon-clean", hexes: ["#171a21"] },
  { donor: "salon-lacquer-studio", hexes: ["#791526"] },
  { donor: "hvac-premier", hexes: ["#fbfaf8"] },
  { donor: "general-contractor-clean", hexes: ["#ff9d67", "#17211f"] },
  { donor: "plumbing-clean", hexes: ["#aa5830", "#f2a618"] },
];

for (const { donor, hexes } of CONVERTED_SWEEPS) {
  test(`${donor}: zero donor-default accent literals survive in css+html`, () => {
    const files = donorFiles(donor);
    for (const [rel, text] of Object.entries(files)) {
      const bare = /\.css$/.test(rel) ? stripCssComments(text) : text;
      for (const hex of hexes) {
        assert.equal(occurrences(bare.toLowerCase(), hex), 0, `${rel}: ${hex} survived`);
      }
    }
  });
}

test("tattoo-aurelia: signal utilities ride --color-signal; the token def is the ONE literal", () => {
  const { key, css } = cssOf("tattoo-aurelia");
  const bare = stripCssComments(css);
  assert.equal(occurrences(bare, "#e65733"), 1,
    "exactly one literal may remain: the --color-signal token definition");
  assert.match(bare, /--color-signal:#e65733/i, "the surviving literal must be the token def");
  // The compiled utilities now reference the token, so a brand swap of
  // --color-signal rebrands every one of them at once.
  for (const util of [".text-signal{color:var(--color-signal)}", ".bg-signal{background-color:var(--color-signal)}",
    ".border-signal{border-color:var(--color-signal)}"]) {
    assert.ok(bare.includes(util), `expected token-driven utility: ${util}`);
  }
  assert.ok(!/background-color:#e65733|color:#e65733|border-color:#e65733/i.test(bare),
    "no signal utility may carry the baked hex");
});

/* ------------------------------------------------------------------------- *
 * 6. THE BRAND THEME-COLOR LAW — mobile browser chrome follows the client
 * ------------------------------------------------------------------------- */

test("theme-color: the default-mode surface is picked (not the dark counterpart)", () => {
  const css = ':root{--wss-surface:#f7f4ee;} :root.dark{--wss-surface:#0b0b0c;}';
  assert.equal(fleetPolish.brandSurfaceHexFromCss([css]), "#f7f4ee");
  assert.equal(fleetPolish.brandSurfaceHexFromCss([':root{--background:#fff}']), null);
  assert.equal(fleetPolish.brandSurfaceHexFromCss([]), null);
});

test("theme-color: both attribute orders rewrite, idempotently, and only theme-color metas", () => {
  const html = '<head>'
    + '<meta name="theme-color" content="#EB0001" />'
    + '<meta content="#18467f" name="theme-color">'
    + '<meta name="description" content="#123456">'
    + '</head>';
  const once = fleetPolish.applyBrandThemeColorMeta(html, "#f7f4ee");
  assert.equal(once.changed, 2, "both theme-color metas rewrite");
  assert.ok(once.html.includes('content="#f7f4ee" /><meta content="#f7f4ee" name="theme-color">'),
    "both metas now carry the client surface");
  assert.ok(once.html.includes('<meta name="description" content="#123456">'),
    "non-theme-color metas are untouched");
  const twice = fleetPolish.applyBrandThemeColorMeta(once.html, "#f7f4ee");
  assert.equal(twice.changed, 0, "a second pass is a no-op");
});

test("theme-color: polishSite stamps the final surface into the served html", () => {
  const html = '<html><head><meta name="theme-color" content="#0f2742"></head>'
    + '<body><div id="root"></div></body></html>';
  const css = ".bg-primary{background-color:hsl(var(--primary))}\n"
    + "/* WSS mirror theme */\n:root{--wss-surface:#f7f4ee;--wss-accent:#b33a3a;--accent:20 60% 46%}\n"
    + '[data-wss-theme="dark"],:root.dark{--wss-surface:#0b0b0c;--accent:20 60% 46%}';
  const result = fleetPolish.polishSite(
    { "index.html": html, "assets/index-donor.css": css },
    {}
  );
  assert.ok(result.files["index.html"].includes('content="#f7f4ee"'),
    "the served theme-color must be the client surface");
  assert.equal(result.applied.themeColorMeta, 1);
});

test("theme-color: a build with no themed sheet leaves donor metas untouched", () => {
  const html = '<html><head><meta name="theme-color" content="#0f2742"></head><body></body></html>';
  const result = fleetPolish.polishSite(
    { "index.html": html, "assets/index-donor.css": ".a{color:red}" },
    {}
  );
  assert.equal(result.applied.themeColorMeta, 0);
  assert.ok(result.files["index.html"].includes('content="#0f2742"'));
});
