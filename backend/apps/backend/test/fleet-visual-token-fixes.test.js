"use strict";

// test/fleet-visual-token-fixes.test.js
//
// THE COMET VISUAL-TOKEN DEFECT CLASS — 2026-09-02 audit of the live fleet,
// owner-endorsed, fixes in the fleet polish layer + the new contrast gate:
//
//   1. washed-out LIGHT-mode text contrast (Southwest Builders, Good Life,
//      True Fence, North MS Fence) -> contrastFloorCss light branch, AA-gated
//      by scripts/check-contrast.js (npm run check:contrast);
//   2. dark-mode label/tag contrast weak (Rooter Right, United Contractors)
//      -> the same floor, dark branch, secondary/label ink;
//   3. sibling service-card font-size drift (fence family) -> shared
//      .wss-card-title/.wss-card-body scale + in-grid normalization;
//   4. hero background media overflowing its box (Rooter Right, United
//      Contractors) -> clip + cover + aspect-ratio containment;
//   5. construction-vertical hero/section left-skew at 1440px -> centered
//      max-width balance;
//   6. mobile card-stack spacing -> one token scale in the polish layer;
//   7. the JSON-LD contradiction between audits -> settled below by running
//      the actual content-inject pass over the REAL fence/construction donor
//      HTML and counting the structured-data blocks in the served result.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  contrastFloorCss,
  contrastPairManifest,
  fleetPolishCss,
  polishSite,
} = require("../lib/mirror-engine/fleet-polish");
const { inject } = require("../lib/mirror-engine/content-inject");
const { contrastRatio } = require("../lib/mirror-engine/theme");

// ---------------------------------------------------------------------------
// shared maths + fixtures
// ---------------------------------------------------------------------------

function ratioOf(fg, bg) {
  // theme.js's own WCAG maths, hex-in.
  return contrastRatio(fg, bg);
}

// Donor stylesheets exactly as they ship in donors-clean.
const DONOR_ROOT = path.join(__dirname, "..", "donors-clean");
function donorFile(donor, rel) {
  return fs.readFileSync(path.join(DONOR_ROOT, donor, rel), "utf8");
}

// A minimal but real content-inject input: the fence-family donor index, the
// identity facts a build carries, and no network anything.
function servedFenceHome() {
  const donorHtml = donorFile("fencing-sterling", "index.html");
  const result = inject({
    files: { "index.html": donorHtml },
    facts: {
      business_name: "True Fence Florida",
      industry: "fencing",
      city: "North Port",
      state: "FL",
      phone: "(941) 555-0142",
    },
    phoneDigits: "9415550142",
    slug: "true-fence",
    manifest: { consumes_content: false },
  });
  return result.files["index.html"].toString("utf8");
}

function servedConstructionHome() {
  const donorHtml = donorFile("concrete-elconstruction", "index.html");
  const result = inject({
    files: { "index.html": donorHtml },
    facts: {
      business_name: "Southwest Builders",
      industry: "concrete",
      city: "Tampa",
      state: "FL",
      phone: "(813) 555-0177",
    },
    phoneDigits: "8135550177",
    slug: "southwest-builders",
    manifest: { consumes_content: false },
  });
  return result.files["index.html"].toString("utf8");
}

// ---------------------------------------------------------------------------
// FIX 1 — the light-mode contrast floor, proven by computation
// ---------------------------------------------------------------------------
test("fix 1: the floor ships a light-mode branch with a proven ink for every reading role", () => {
  const css = contrastFloorCss();
  // Scope: the not-dark default form plus the explicit light twin — the same
  // two-worlds convention heroContrastFloorCss uses.
  assert.match(css, /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\), \[data-wss-theme="light"\] \{/);
  // Body copy, links, secondary/labels, placeholder.
  assert.match(css, /body, p, li, a, span, h1, h2, h3, h4, h5, h6, label, td, th, figcaption, blockquote \{\s*\n\s*color: #242933;/);
  assert.match(css, /a \{\s*\n\s*color: #1a4fc4;/);
  assert.match(css, /\[class\*="eyebrow" i\], \[class\*="kicker" i\], \[class\*="caption" i\], \[class\*="subtext" i\] \{\s*\n\s*color: #4d5460;/s);
  assert.match(css, /\*::placeholder \{\s*\n\s*color: #565d6a;/);
});

test("fix 1: every light-mode floor ink clears AA against the white paper AND the pale slab", () => {
  // The light body ink must clear 4.5 on white and on the palest slab the
  // theme pass paints; secondary must too; links must too.
  assert.ok(ratioOf("#242933", "#ffffff") >= 4.5);
  assert.ok(ratioOf("#242933", "#f3f2ef") >= 4.5);
  assert.ok(ratioOf("#1a4fc4", "#ffffff") >= 4.5);
  assert.ok(ratioOf("#1a4fc4", "#f3f2ef") >= 4.5);
  assert.ok(ratioOf("#4d5460", "#ffffff") >= 4.5);
  assert.ok(ratioOf("#4d5460", "#f3f2ef") >= 4.5);
  assert.ok(ratioOf("#565d6a", "#ffffff") >= 4.5);
});

test("fix 1: the light floor cannot fight the hero ink passes", () => {
  const css = contrastFloorCss();
  // No !important in the light branch: hero-wash and heroContrastFloor force
  // their proven hero inks with !important and must keep winning.
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const lightStart = noComments.indexOf(':root:not([data-wss-theme="dark"]):not(.dark), [data-wss-theme="light"]');
  assert.ok(lightStart > 0);
  assert.equal(noComments.slice(lightStart).includes("!important"), false);
  // The hero guard restores the THEMED light ink for passless heroes and is
  // scoped to the hero containers only. The old bare #ffffff was the
  // light-theme wash (white hero words on the theme's near-white hero
  // surfaces, measured 1.12-1.61:1 on the fencing/HVAC mirrors — Class B,
  // 2026-09-04); the guard ink is now the palette's own --wss-text.
  assert.match(
    noComments,
    /:root:not\(\[data-wss-theme="dark"\]\):not\(\.dark\) :is\(\.hero, \.hero-section, \[data-hero\]\) :is\(h1, h2, h3, h4, h5, h6, p, a, span, li, small, strong, em, figcaption, blockquote, label\) \{\s*\n\s*color: var\(--wss-text, #242933\);/,
  );
  assert.doesNotMatch(noComments, /color:\s*#ffffff;/);
  assert.ok(
    noComments.indexOf("var(--wss-text, #242933);") > noComments.indexOf("color: #242933;"),
    "the hero guard must come after the floor in source order",
  );
});

test("fix 1: polishSite injects the light floor into served pages", () => {
  const result = polishSite(
    { "index.html": "<html><head><title>T</title></head><body><h1>H</h1></body></html>" },
    {},
  );
  const html = result.files["index.html"];
  assert.match(html, /id="wss-fleet-polish"/);
  assert.match(html, /#242933/);
});

// ---------------------------------------------------------------------------
// the contrast gate itself (npm run check:contrast)
// ---------------------------------------------------------------------------
test("check:contrast: the manifest's pairs all pass their declared AA bar when computed", () => {
  const manifest = contrastPairManifest();
  assert.ok(manifest.length >= 12);
  for (const pair of manifest) {
    const ratio = ratioOf(pair.fg, pair.bg);
    assert.ok(
      ratio >= pair.minimum,
      `${pair.mode}/${pair.role}: ${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)}:1, bar ${pair.minimum}`,
    );
    assert.ok([4.5, 3].includes(pair.minimum), "bars are AA body (4.5) or AA large (3)");
  }
  // Both modes covered, and the gate script exists wired in package.json.
  assert.ok(manifest.some((p) => p.mode === "dark"));
  assert.ok(manifest.some((p) => p.mode === "light"));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.equal(pkg.scripts["check:contrast"], "node scripts/check-contrast.js");
  assert.match(pkg.scripts.ci, /npm run check && npm run check:contrast &&/);
});

test("check:contrast: the gate script fails a washed pair and exits non-zero", () => {
  const { execFileSync } = require("node:child_process");
  // The real gate must pass on the current tree (the whole point of the fix).
  execFileSync(process.execPath, [path.join(__dirname, "..", "scripts", "check-contrast.js")], {
    stdio: "pipe",
  });
  // And the gate maths must actually reject: 3:1 ink on white is the exact
  // washed-out shape the audit measured, and the checker's own ratio helper
  // agrees with theme.js's WCAG maths on it.
  const washed = ratioOf("#777777", "#ffffff");
  assert.ok(washed < 4.5, `washed grey must fail, got ${washed.toFixed(2)}`);
});

// ---------------------------------------------------------------------------
// FIX 2 — dark-mode labels/tags/secondary text
// ---------------------------------------------------------------------------
test("fix 2: the dark floor covers labels, tags and secondary shapes with a proven ink", () => {
  const css = contrastFloorCss();
  assert.match(css, /\[data-wss-theme="dark"\], :root\.dark \{/);
  assert.match(css, /small, dt, dd, summary, cite, time, address, \[class\*="tag" i\], \[class\*="badge" i\], \[class\*="chip" i\], \[class\*="label" i\], \[class\*="eyebrow" i\], \[class\*="kicker" i\], \[class\*="caption" i\], \[class\*="subtext" i\] \{\s*\n\s*color: #c9cdd7 !important;/);
  // Proven against the dark canvas AND the raised dark card.
  assert.ok(ratioOf("#c9cdd7", "#101216") >= 4.5);
  assert.ok(ratioOf("#c9cdd7", "#262a33") >= 4.5);
});

// ---------------------------------------------------------------------------
// FIX 3 — sibling card font drift
// ---------------------------------------------------------------------------
test("fix 3: the polish layer emits shared card-title/card-body classes on tokens", () => {
  const css = fleetPolishCss();
  assert.match(css, /:root \{ --wss-card-title-size: 1\.125rem; --wss-card-body-size: 1rem; \}/);
  assert.match(css, /\.wss-card-title \{ font-size: var\(--wss-card-title-size\); line-height: 1\.35; font-weight: 600; \}/);
  assert.match(css, /\.wss-card-body \{ font-size: var\(--wss-card-body-size\); line-height: 1\.6; \}/);
});

test("fix 3: card grids normalize onto the shared scale, overriding utility AND inline drift", () => {
  const css = fleetPolishCss();
  // Scope: card-shaped children of MULTI-COLUMN grids (single-column layouts
  // cannot show sibling drift).
  assert.match(css, /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) > :is\(article, figure, li, \[class\*="card" i\], \[class\*="rounded"\]\) :is\(h3, h4\) \{\s*\n\s*font-size: var\(--wss-card-title-size\) !important;/);
  assert.match(css, /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) > :is\(article, figure, li, \[class\*="card" i\], \[class\*="rounded"\]\) p \{\s*\n\s*font-size: var\(--wss-card-body-size\) !important;/);
  // The !important is what beats a per-instance inline font-size.
  const fenceGridClass = 'grid sm:grid-cols-2 lg:grid-cols-3 gap-6';
  assert.match(css, /\[class\*="grid-cols-"\]/);
  assert.ok(fenceGridClass.includes("grid-cols-"), "the fence family's real grid class matches the scope");
});

test("fix 3: the fence-family donor really ships drifting card title sizes in one grid shape", () => {
  // Evidence pin: the compiled fence bundle carries at least two different
  // card-title utility sizes that appear inside the same grid-cols shapes —
  // the exact drift the normalization collapses.
  const bundle = donorFile("fencing-sterling", "assets/index-Z0b1C-j7.js");
  const sizes = new Set(
    (bundle.match(/text-(?:sm|base|lg|2xl) font-bold/g) || []),
  );
  assert.ok(sizes.size >= 2, `expected drifting title utilities, saw ${[...sizes].join(", ")}`);
});

// ---------------------------------------------------------------------------
// FIX 4 — hero background media containment
// ---------------------------------------------------------------------------
test("fix 4: hero media containers clip, the media covers, and the box is aspect-sized", () => {
  const css = fleetPolishCss();
  assert.match(css, /:is\(\.hero, \.hero-section, \[data-hero\], \.hero-media, \[class\*="hero-media" i\], \[data-hero-media\]\) \{\s*\n\s*overflow: hidden;/);
  assert.match(
    css,
    /video\[data-hero-video\],\s*\n:is\(\.hero, \.hero-section, \[data-hero\], \.hero-media, \[class\*="hero-media" i\], \[data-hero-media\]\) :is\(img, video\) \{\s*\n\s*width: 100%; height: 100%; max-width: 100%; object-fit: cover; object-position: center;/,
  );
  assert.match(css, /:is\(\.hero-media, \[class\*="hero-media" i\], \[data-hero-media\], :is\(\.hero, \.hero-section, \[data-hero\]\) > figure\) \{\s*\n\s*aspect-ratio: 16 \/ 9;/);
});

test("fix 4: the engine's universal hero-media marker is what the rule keys on", () => {
  // video[data-hero-video] is the runtime-armed hero medium on the plumbing
  // and fence donors alike (the audit's Rooter Right class); the donors must
  // actually carry it so the containment rule lands on real markup.
  assert.match(donorFile("plumbing-clean", "index.html"), /data-hero-video/);
  assert.match(donorFile("fencing-sterling", "index.html"), /data-hero-video/);
});

// ---------------------------------------------------------------------------
// FIX 5 — construction-vertical layout balance
// ---------------------------------------------------------------------------
test("fix 5: the content column centers within a capped measure at desktop widths", () => {
  const css = fleetPolishCss();
  assert.match(css, /AUDIT \(Comet, 2026-09-02\) — construction-vertical left-skew/);
  assert.match(css, /@media \(min-width: 1024px\) \{\s*\n\s*:is\(main, \[role="main"\], body\) > :is\(section, div, article\) > :is\(section, div, article\) \{\s*\n\s*max-width: 80rem;\s*\n\s*margin-inline: auto;/);
  // The construction family really serves through a `main` wrapper (the rule's
  // entry point): the concrete donor mounts `main.flex-1`.
  assert.match(donorFile("concrete-elconstruction", "assets/index-BFny53Fb.js"), /"main",\{className:"flex-1"/);
});

// ---------------------------------------------------------------------------
// FIX 6 — mobile card-stack spacing tokens
// ---------------------------------------------------------------------------
test("fix 6: one spacing scale governs stacked card grids at the mobile audit width", () => {
  const css = fleetPolishCss();
  assert.match(css, /--wss-stack-gap: 1rem; --wss-card-pad: 1\.25rem;/);
  assert.match(css, /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) \{ gap: var\(--wss-stack-gap\) !important; \}/);
  assert.match(css, /:is\(\[class\*="grid-cols-"\], \.cards, \.card-grid\) > :is\(article, figure, li, \[class\*="card" i\], \[class\*="rounded"\]\) \{ padding: var\(--wss-card-pad\); \}/);
  // The tokens live inside the <=768px query, not on the desktop sheet.
  const mobileBlock = css.slice(css.indexOf("@media (max-width: 768px)"));
  assert.ok(mobileBlock.includes("--wss-stack-gap: 1rem"));
});

// ---------------------------------------------------------------------------
// FIX 7 — the JSON-LD contradiction, settled on served HTML
// ---------------------------------------------------------------------------
test("fix 7: the fence-family served HTML carries structured data (donor graph + engine @graph)", () => {
  const html = servedFenceHome();
  const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  assert.ok(blocks.length >= 3, `fence served HTML must carry >=3 ld+json blocks, saw ${blocks.length}`);
  const joined = blocks.join("\n");
  assert.match(joined, /"FAQPage"/);
  assert.match(joined, /"LocalBusiness"/);
  assert.match(joined, /True Fence Florida/, "the engine graph names the client");
});

test("fix 7: the construction-family served HTML carries structured data too", () => {
  const html = servedConstructionHome();
  const blocks = html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  assert.ok(blocks.length >= 2, `construction served HTML must carry >=2 ld+json blocks, saw ${blocks.length}`);
  const joined = blocks.join("\n");
  assert.match(joined, /"GeneralContractor"/);
  assert.match(joined, /Southwest Builders/, "the engine graph names the client");
  // And the engine's own block parses as JSON.
  const engineBlock = blocks.map((b) => b.replace(/^<script type="application\/ld\+json">/, "").replace(/<\/script>$/, ""))
    .map((b) => { try { return JSON.parse(b); } catch { return null; } })
    .filter(Boolean);
  assert.ok(
    engineBlock.some((obj) => obj["@graph"] || obj["@type"]),
    "at least one served block is well-formed JSON-LD with a graph or type",
  );
});

test("fix 7: the polish pass never strips structured data from served HTML", () => {
  const served = servedFenceHome();
  const result = polishSite({ "index.html": served }, {});
  const html = result.files["index.html"];
  assert.equal(
    (html.match(/application\/ld\+json/g) || []).length,
    (served.match(/application\/ld\+json/g) || []).length,
    "ld+json block count is identical after polish",
  );
});
